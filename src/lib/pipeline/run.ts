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

export function startRun(db: Db, args: { competitorId: number; label: string; cutoffDate: string }): Run {
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
    stats.wallMs = Date.now() - t0;
    return db
      .update(schema.runs)
      .set({ status: "failed", error: message, finishedAt: new Date().toISOString(), stats, log })
      .where(eq(schema.runs.id, run.id))
      .returning()
      .get();
  };

  db.update(schema.runs).set({ status: "running", startedAt: new Date().toISOString() }).where(eq(schema.runs.id, run.id)).run();
  emit({ stage: "select", message: `${run.label}: analyzing pages dated on or before ${run.cutoffDate}` });

  const ctx = loadCompanyContext(db, run.competitorId);

  let extraction;
  try {
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
