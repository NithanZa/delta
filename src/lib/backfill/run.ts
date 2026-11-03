/**
 * Execute a backfill plan: fetch the captures for each cutoff, then run a
 * `backfill` run at that cutoff. Resumable (a cutoff with a done backfill run
 * is skipped) and bounded (stops after three consecutive failed runs).
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { env } from "@/lib/env";
import { discoverCompetitor } from "@/lib/ingest/discovery";
import type { ExaOptions } from "@/lib/ingest/exa";
import { createSnapshot } from "@/lib/ingest/snapshot";
import { enqueue } from "@/lib/jobs/queue";
import type { LlmClient } from "@/lib/llm/client";
import { selectSnapshotsForRun } from "@/lib/pipeline/extract";
import { executeRun, releaseOrphanedRuns, startRun } from "@/lib/pipeline/run";
import { planBackfill, type BackfillPlan, type PlanOptions } from "./plan";

export type BackfillProgress = { stage: string; cutoffsDone: number; cutoffsTotal: number; pagesFetched: number; currentCutoff: string | null; runsFailed: number; costUsd: number };

export type BackfillOptions = PlanOptions & {
  withDiscovery?: boolean;
  fetchImpl?: typeof fetch;
  exa?: ExaOptions;
  client?: LlmClient;
  plan?: BackfillPlan;
  onProgress?: (p: BackfillProgress) => void;
  /** Queue a normal run afterwards (default true). */
  enqueueRun?: boolean;
  /** The caller knows no other process owns a backfill for this competitor: release its leftover running run first. */
  releaseOrphans?: boolean;
};

export type BackfillResult = BackfillProgress & { cutoffsSkipped: number; stopped: boolean };

const MAX_CONSECUTIVE_FAILURES = 3;

export function doneBackfillCutoffs(db: Db, competitorId: number): Set<string> {
  return new Set(
    db
      .select({ cutoffDate: schema.runs.cutoffDate })
      .from(schema.runs)
      .where(and(eq(schema.runs.competitorId, competitorId), eq(schema.runs.kind, "backfill"), eq(schema.runs.status, "done")))
      .all()
      .map((r) => r.cutoffDate),
  );
}

export async function runBackfill(db: Db, competitorId: number, opts: BackfillOptions = {}): Promise<BackfillResult> {
  const log = opts.log ?? (() => {});
  if (opts.releaseOrphans) {
    const released = releaseOrphanedRuns(db, competitorId, ["backfill"], "Interrupted; this backfill was resumed");
    if (released) log(`released ${released} interrupted backfill run(s)`);
  }
  const plan = opts.plan ?? (await planBackfill(db, competitorId, { ...opts, cdx: { ...opts.cdx, fetchImpl: opts.cdx?.fetchImpl ?? opts.fetchImpl } }));
  const done = doneBackfillCutoffs(db, competitorId);
  const progress: BackfillProgress = { stage: "starting", cutoffsDone: 0, cutoffsTotal: plan.cutoffs.length, pagesFetched: 0, currentCutoff: null, runsFailed: 0, costUsd: 0 };
  const report = (stage: string) => {
    progress.stage = stage;
    opts.onProgress?.({ ...progress });
  };
  let skipped = 0;
  let consecutiveFailures = 0;
  let stopped = false;
  let previousCutoff: string | null = null;
  log(`backfill plan: ${plan.cutoffs.length} cutoff(s), ${plan.estimate.pages} page(s), ${done.size} already done`);

  for (const cutoff of plan.cutoffs) {
    progress.currentCutoff = cutoff.cutoffDate;
    if (done.has(cutoff.cutoffDate)) {
      skipped++;
      progress.cutoffsDone++;
      log(`≤ ${cutoff.cutoffDate}: already done, skipped`);
      report("skipping");
      previousCutoff = cutoff.cutoffDate;
      continue;
    }
    report(`fetching captures for ≤ ${cutoff.cutoffDate}`);
    for (const f of cutoff.fetches) {
      try {
        const { created, snapshot } = await createSnapshot(db, { competitorId, url: f.url, sourceType: f.sourceType, provider: "backfill", publishedAt: f.date, archiveTimestamp: f.timestamp, fetchOptions: { fetchImpl: opts.fetchImpl, timeoutMs: 90_000 } });
        if (created) {
          progress.pagesFetched++;
          log(`  captured ${f.url} @ ${f.date} → S${snapshot.id}`);
        } else {
          log(`  unchanged ${f.url} @ ${f.date} (same content as an earlier capture)`);
        }
      } catch (e) {
        log(`  could not fetch ${f.url} @ ${f.timestamp}: ${(e as Error).message}`);
      }
    }
    if (opts.withDiscovery && (env.exaApiKey || opts.exa)) {
      report(`discovery for ≤ ${cutoff.cutoffDate}`);
      try {
        const since = previousCutoff ?? new Date(new Date(`${cutoff.cutoffDate}T00:00:00Z`).getTime() - 92 * 86_400_000).toISOString().slice(0, 10);
        const r = await discoverCompetitor(db, competitorId, { since, until: cutoff.cutoffDate, fetchImpl: opts.fetchImpl, exa: opts.exa, client: opts.client, maxNewPages: 5, log: (m) => log(`  discovery: ${m}`) });
        progress.pagesFetched += r.created;
      } catch (e) {
        log(`  discovery failed: ${(e as Error).message}`);
      }
    }
    const pending = selectSnapshotsForRun(db, competitorId, cutoff.cutoffDate).length;
    if (pending === 0) {
      log(`≤ ${cutoff.cutoffDate}: nothing new to analyze, no run`);
      progress.cutoffsDone++;
      report("no run needed");
      previousCutoff = cutoff.cutoffDate;
      continue;
    }
    report(`run ≤ ${cutoff.cutoffDate} (${pending} page(s))`);
    try {
      const run = startRun(db, { competitorId, kind: "backfill", label: `Backfill ≤ ${cutoff.cutoffDate}`, cutoffDate: cutoff.cutoffDate });
      const result = await executeRun(db, run.id, (e) => log(`  [${e.stage}] ${e.message}`), opts.client);
      progress.costUsd += result.stats.costUsd ?? 0;
      if (result.status === "done") {
        consecutiveFailures = 0;
        log(`≤ ${cutoff.cutoffDate}: run done (${result.stats.facts ?? 0} facts, ${result.stats.insights ?? 0} insights)`);
      } else {
        consecutiveFailures++;
        progress.runsFailed++;
        log(`≤ ${cutoff.cutoffDate}: run failed: ${result.error}`);
      }
    } catch (e) {
      consecutiveFailures++;
      progress.runsFailed++;
      log(`≤ ${cutoff.cutoffDate}: could not run: ${(e as Error).message}`);
    }
    progress.cutoffsDone++;
    report("cutoff finished");
    previousCutoff = cutoff.cutoffDate;
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      stopped = true;
      log(`stopping after ${consecutiveFailures} consecutive failed runs`);
      break;
    }
  }
  if (opts.enqueueRun !== false && !stopped) {
    enqueue(db, { kind: "run", competitorId, requestedBy: "schedule", payload: { after: "backfill" } });
    log("queued a normal run for anything newer than the last cutoff");
  }
  progress.currentCutoff = null;
  report(stopped ? "stopped" : "finished");
  return { ...progress, cutoffsSkipped: skipped, stopped };
}
