import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { Run, RunLogEntry, RunStats } from "@/db/schema";
import type { LlmClient, LlmUsage } from "@/lib/stepfun/client";
import { loadCompanyContext } from "./context";
import type { OnEvent, RunEvent } from "./events";
import { runExtraction } from "./extract";
import { loadResearchState } from "./state";
import { runInsights, runSynthesis } from "./synthesize";

const STALE_AFTER_MS = 10 * 60 * 1000;

/**
 * The run currently in flight for a competitor, if any. A run whose log has
 * not advanced in 10 minutes (server restart, crash) is marked failed so it
 * cannot block future runs forever.
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
    db.update(schema.runs)
      .set({ status: "failed", error: "Run stopped making progress (server restarted?)", finishedAt: new Date().toISOString() })
      .where(eq(schema.runs.id, active.id))
      .run();
    db.update(schema.snapshots).set({ processedRunId: null }).where(eq(schema.snapshots.processedRunId, active.id)).run();
    db.delete(schema.facts).where(eq(schema.facts.runId, active.id)).run();
    return undefined;
  }
  return active;
}

export function startRun(db: Db, args: { competitorId: number; label: string; cutoffDate: string }): Run {
  const active = findActiveRun(db, args.competitorId);
  if (active) throw new Error(`${active.label} is already running`);
  return db.insert(schema.runs).values({ ...args, status: "queued" }).returning().get();
}

function addUsage(stats: RunStats, u: LlmUsage) {
  stats.promptTokens = (stats.promptTokens ?? 0) + u.promptTokens;
  stats.completionTokens = (stats.completionTokens ?? 0) + u.completionTokens;
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
  addUsage(stats, extraction.usage);
  stats.snapshots = extraction.processedSnapshotIds.length;
  stats.facts = extraction.facts.length;
  stats.changes = extraction.changes.length;
  emit({ stage: "extract", message: `Extraction done: ${stats.facts} fact(s), ${stats.changes} change(s) from ${stats.snapshots} page(s)` });

  const state = loadResearchState(db, run.competitorId, run.id);
  let synthesis;
  try {
    emit({ stage: "synthesis", message: `Updating hypotheses, timeline and strategy profile with ${newFacts.length} new fact(s) (step-5-preview)…` });
    synthesis = await runSynthesis(db, run, ctx, state, newFacts, emit, client);
  } catch (e) {
    return fail("synthesis", e);
  }
  addUsage(stats, synthesis.usage);
  stats.hypothesesUpdated = synthesis.hypothesisUpdates.length;

  try {
    emit({ stage: "insights", message: `Writing insights and recommended actions for ${ctx.company.name}…` });
    const ins = await runInsights(db, run, ctx, synthesis, newFacts, state, emit, client);
    addUsage(stats, ins.usage);
    stats.insights = ins.insights.length;
  } catch (e) {
    return fail("insights", e);
  }

  stats.wallMs = Date.now() - t0;
  emit({ stage: "finalize", message: `Done in ${Math.round(stats.wallMs / 1000)}s · ${stats.promptTokens ?? 0} prompt + ${stats.completionTokens ?? 0} completion tokens` });
  return db
    .update(schema.runs)
    .set({ status: "done", finishedAt: new Date().toISOString(), stats, log })
    .where(eq(schema.runs.id, run.id))
    .returning()
    .get();
}
