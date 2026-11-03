import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { Run, RunKind, RunLogEntry, RunStats } from "@/db/schema";
import { addUsage as addLlmUsage, type LlmClient, type LlmRole, type LlmUsage } from "@/lib/llm/client";
import { getLlmConfig, getModelLabels } from "@/lib/llm/config";
import { estimateRunCostUsd } from "@/lib/llm/pricing";
import { loadCompanyContext } from "./context";
import type { OnEvent, RunEvent } from "./events";
import { runExtraction } from "./extract";
import { loadResearchState } from "./state";
import { runInsights, runSynthesis } from "./synthesize";

/** A run whose log has not advanced for this long is presumed dead (server restart, crash). The synthesis heartbeat below keeps live runs under it. */
export const STALE_AFTER_MS = 20 * 60 * 1000;
const HEARTBEAT_MS = 60 * 1000;

/**
 * The run currently in flight for a competitor, if any. A run whose log has
 * not advanced in 20 minutes is marked failed so it cannot block future runs forever.
 */
export function findActiveRun(db: Db, competitorId: number): Run | undefined {
  const active = db
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.competitorId, competitorId))
    .all()
    .find((r) => r.status === "running" || r.status === "queued");
  if (!active) return undefined;
  const lastTs = active.log.at(-1)?.ts ?? active.startedAt ?? new Date(0).toISOString();
  if (Date.now() - new Date(lastTs).getTime() > STALE_AFTER_MS) {
    releaseRun(db, active.id, "Run stopped making progress (server restarted?)");
    return undefined;
  }
  return active;
}

/** Mark a dead run failed and give its pages back to the next attempt. */
export function releaseRun(db: Db, runId: number, error: string) {
  db.update(schema.runs).set({ status: "failed", error, finishedAt: new Date().toISOString() }).where(eq(schema.runs.id, runId)).run();
  db.update(schema.snapshots).set({ processedRunId: null }).where(eq(schema.snapshots.processedRunId, runId)).run();
  db.delete(schema.facts).where(eq(schema.facts.runId, runId)).run();
}

/**
 * Release in-flight runs of the given kinds for a competitor, for use when the
 * process that owned them is known to be dead (worker restart, resumed backfill).
 * Waiting for the staleness window would block the restart for 20 minutes.
 */
export function releaseOrphanedRuns(db: Db, competitorId: number, kinds: RunKind[], error: string): number {
  const orphans = db
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.competitorId, competitorId))
    .all()
    .filter((r) => (r.status === "running" || r.status === "queued") && kinds.includes(r.kind));
  for (const r of orphans) releaseRun(db, r.id, error);
  return orphans.length;
}

export function startRun(db: Db, args: { competitorId: number; label: string; cutoffDate: string; kind?: RunKind }): Run {
  const active = findActiveRun(db, args.competitorId);
  if (active) throw new Error(`${active.label} is already running`);
  return db
    .insert(schema.runs)
    .values({ competitorId: args.competitorId, label: args.label, cutoffDate: args.cutoffDate, kind: args.kind ?? "manual", status: "queued" })
    .returning()
    .get();
}

function addUsage(stats: RunStats, role: LlmRole, u: LlmUsage) {
  stats.promptTokens = (stats.promptTokens ?? 0) + u.promptTokens;
  stats.completionTokens = (stats.completionTokens ?? 0) + u.completionTokens;
  stats.cacheReadTokens = (stats.cacheReadTokens ?? 0) + (u.cacheReadTokens ?? 0);
  stats.cacheWriteTokens = (stats.cacheWriteTokens ?? 0) + (u.cacheWriteTokens ?? 0);
  stats.byRole ??= {};
  stats.byRole[role] = addLlmUsage(stats.byRole[role] ?? { promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, u);
}

/** Fill in the model ids and the estimated cost once every stage has reported its usage. */
function finalizeStats(stats: RunStats) {
  const labels = getModelLabels();
  stats.models = { extract: labels.extract, synthesize: labels.synthesize };
  stats.costUsd = stats.byRole ? estimateRunCostUsd(stats.byRole, getLlmConfig()) : null;
}

/**
 * Execute a queued run: select → extract → synthesis → insights → finalize.
 * Every event is appended to runs.log. A failing stage marks the run failed
 * but keeps whatever earlier stages persisted.
 */
export async function executeRun(db: Db, runId: number, onEvent: OnEvent = () => {}, client?: LlmClient): Promise<Run> {
  const run = db.select().from(schema.runs).where(eq(schema.runs.id, runId)).get();
  if (!run) throw new Error(`Run ${runId} not found`);

  const log: RunLogEntry[] = [];
  const stats: RunStats = {};
  const t0 = Date.now();
  const emit: OnEvent = (e: RunEvent) => {
    log.push({ ts: new Date().toISOString(), level: e.level ?? "info", message: `[${e.stage}] ${e.message}` });
    db.update(schema.runs).set({ log }).where(eq(schema.runs.id, run.id)).run();
    onEvent(e);
  };
  const fail = (stage: RunEvent["stage"], e: unknown): Run => {
    const message = (e as Error).message ?? String(e);
    emit({ stage: "error", level: "error", message: `${stage} failed: ${message}` });
    if (stage !== "insights") {
      // Give the pages back to the next attempt; facts without synthesis would otherwise be orphaned.
      db.update(schema.snapshots).set({ processedRunId: null }).where(eq(schema.snapshots.processedRunId, run.id)).run();
      db.delete(schema.facts).where(eq(schema.facts.runId, run.id)).run();
      emit({ stage: "error", level: "warn", message: "Pages from this run were released so the next run can analyze them again" });
    }
    stats.wallMs = Date.now() - t0;
    finalizeStats(stats);
    return db
      .update(schema.runs)
      .set({ status: "failed", error: message, finishedAt: new Date().toISOString(), stats, log })
      .where(eq(schema.runs.id, run.id))
      .returning()
      .get();
  };

  db.update(schema.runs).set({ status: "running", startedAt: new Date().toISOString() }).where(eq(schema.runs.id, run.id)).run();

  let ctx;
  let extraction;
  try {
    emit({ stage: "select", message: `${run.label}: analyzing pages dated on or before ${run.cutoffDate}` });
    ctx = loadCompanyContext(db, run.competitorId);
    extraction = await runExtraction(db, run, ctx, emit, client);
  } catch (e) {
    return fail("extract", e);
  }
  const newFacts = [...extraction.facts, ...extraction.changes];
  addUsage(stats, "extract", extraction.usage);
  stats.snapshots = extraction.processedSnapshotIds.length;
  stats.facts = extraction.facts.length;
  stats.changes = extraction.changes.length;
  emit({ stage: "extract", message: `Extraction done: ${stats.facts} fact(s), ${stats.changes} change(s) from ${stats.snapshots} page(s)` });

  const state = loadResearchState(db, run.competitorId, run.id);
  // Long model calls log a heartbeat so findActiveRun does not mistake a live run for a dead one.
  const heartbeat = (stage: RunEvent["stage"]) => setInterval(() => emit({ stage, message: "still reasoning…" }), HEARTBEAT_MS);
  let synthesis;
  let ticker = heartbeat("synthesis");
  try {
    emit({ stage: "synthesis", message: `Updating hypotheses, timeline and strategy profile with ${newFacts.length} new fact(s) (${getModelLabels().synthesize})…` });
    synthesis = await runSynthesis(db, run, ctx, state, newFacts, emit, client);
  } catch (e) {
    return fail("synthesis", e);
  } finally {
    clearInterval(ticker);
  }
  addUsage(stats, "synthesize", synthesis.usage);
  stats.hypothesesUpdated = synthesis.hypothesisUpdates.length;

  ticker = heartbeat("insights");
  try {
    emit({ stage: "insights", message: `Writing insights and recommended actions for ${ctx.company.name}…` });
    const ins = await runInsights(db, run, ctx, synthesis, newFacts, state, emit, client);
    addUsage(stats, "synthesize", ins.usage);
    stats.insights = ins.insights.length;
  } catch (e) {
    return fail("insights", e);
  } finally {
    clearInterval(ticker);
  }

  stats.wallMs = Date.now() - t0;
  finalizeStats(stats);
  emit({
    stage: "finalize",
    message: `Done in ${Math.round(stats.wallMs / 1000)}s · ${stats.promptTokens ?? 0} prompt (${stats.cacheReadTokens ?? 0} cached) + ${stats.completionTokens ?? 0} completion tokens${
      stats.costUsd != null ? ` · ≈$${stats.costUsd.toFixed(3)}` : ""
    }`,
  });
  return db
    .update(schema.runs)
    .set({ status: "done", finishedAt: new Date().toISOString(), stats, log })
    .where(eq(schema.runs.id, run.id))
    .returning()
    .get();
}
