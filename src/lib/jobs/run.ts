/**
 * Execute one claimed job. Each kind is a thin wrapper around the library
 * function it calls; the job row collects the log and the outcome.
 */
import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, isNull } from "drizzle-orm";
import type Database from "better-sqlite3";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { Job } from "@/db/schema";
import { runDigestJob } from "@/lib/digest/job";
import { ResendSender, type EmailSender } from "@/lib/digest/send";
import type { ExaOptions } from "@/lib/ingest/exa";
import { crawlCompetitor } from "@/lib/ingest/crawl";
import { discoverCompetitor, exaTextFallback } from "@/lib/ingest/discovery";
import { runAbsenceChecks } from "@/lib/pipeline/absence";
import { runBackfill } from "@/lib/backfill/run";
import type { BackfillStep } from "@/lib/backfill/plan";
import { getSetting } from "@/lib/settings";
import { env } from "@/lib/env";
import type { LlmClient } from "@/lib/llm/client";
import { scheduledPreset } from "@/lib/pipeline/presets";
import { executeRun, startRun } from "@/lib/pipeline/run";
import { appendLog, finish } from "./queue";

export type JobRunnerOptions = {
  now?: Date;
  /** Injected model client (tests). */
  client?: LlmClient;
  /** Injected fetch (tests). */
  fetchImpl?: typeof fetch;
  backupDir?: string;
  keepBackups?: number;
  /** Injected email transport (tests); the worker uses Resend. */
  sender?: EmailSender;
  /** Injected Exa transport (tests). */
  exa?: ExaOptions;
};

export const KEEP_BACKUPS = 14;

/** Why a scheduled run should proceed, or null when nothing new has arrived since the last run. */
export function pendingWorkReason(db: Db, competitorId: number): string | null {
  const pending = db
    .select({ id: schema.snapshots.id })
    .from(schema.snapshots)
    .where(and(eq(schema.snapshots.competitorId, competitorId), isNull(schema.snapshots.processedRunId)))
    .all().length;
  if (pending > 0) return `${pending} new page(s) to analyze`;
  // A correction is pending when it is set and no run has acknowledged it yet.
  const pendingCorrections = db
    .select({ id: schema.hypotheses.id, userCorrection: schema.hypotheses.userCorrection })
    .from(schema.hypotheses)
    .where(and(eq(schema.hypotheses.competitorId, competitorId), isNull(schema.hypotheses.correctionAppliedRunId)))
    .all()
    .filter((h) => h.userCorrection);
  if (pendingCorrections.length > 0) return `${pendingCorrections.length} pending correction(s)`;
  // Phase 7 adds: unprocessed internal notes from partner replies.
  return null;
}

function lastDoneRun(db: Db, competitorId: number) {
  return db
    .select()
    .from(schema.runs)
    .where(and(eq(schema.runs.competitorId, competitorId), eq(schema.runs.status, "done")))
    .orderBy(desc(schema.runs.id))
    .get();
}

/** Copy the live database with SQLite's online backup API and prune old copies. */
export async function runBackup(db: Db, opts: JobRunnerOptions = {}): Promise<{ file: string; pruned: string[] }> {
  const dir = opts.backupDir ?? path.resolve(process.cwd(), "data", "backups");
  fs.mkdirSync(dir, { recursive: true });
  const now = opts.now ?? new Date();
  const file = path.join(dir, `delta-${now.toISOString().slice(0, 19).replace(/[:T]/g, "-")}.db`);
  const client = (db as unknown as { $client: Database.Database }).$client;
  await client.backup(file);
  const keep = opts.keepBackups ?? KEEP_BACKUPS;
  const all = fs
    .readdirSync(dir)
    .filter((f) => /^delta-.*\.db$/.test(f))
    .sort();
  const pruned = all.slice(0, Math.max(0, all.length - keep));
  for (const f of pruned) fs.unlinkSync(path.join(dir, f));
  return { file, pruned };
}

export async function runJob(db: Db, job: Job, opts: JobRunnerOptions = {}): Promise<Job> {
  const log = (message: string, level: "info" | "warn" | "error" = "info") => appendLog(db, job.id, { level, message });
  try {
    switch (job.kind) {
      case "crawl": {
        const competitors = job.competitorId
          ? db.select().from(schema.competitors).where(eq(schema.competitors.id, job.competitorId)).all()
          : db.select().from(schema.competitors).all();
        let errors = 0;
        for (const c of competitors) {
          const r = await crawlCompetitor(db, c.id, { fetchImpl: opts.fetchImpl, now: opts.now, fallbackText: env.exaApiKey || opts.exa ? (url) => exaTextFallback(url, opts.exa) : undefined, log: (m) => log(`${c.slug}: ${m}`) });
          errors += r.errors;
          log(`${c.slug}: checked ${r.checked}, changed ${r.changed}, new pages ${r.newPages}, errors ${r.errors}`);
        }
        return finish(db, job.id, errors ? "failed" : "done", errors ? `${errors} fetch error(s); see the log` : undefined);
      }
      case "run": {
        if (!job.competitorId) return finish(db, job.id, "failed", "run jobs need a competitor");
        const reason = pendingWorkReason(db, job.competitorId);
        if (!reason) {
          const last = lastDoneRun(db, job.competitorId);
          const msg = `nothing new since ${last ? `${last.label} (${(last.finishedAt ?? last.startedAt ?? "").slice(0, 10)})` : "the start"}`;
          log(`Skipped: ${msg}`);
          return finish(db, job.id, "skipped", msg);
        }
        log(`Starting a run: ${reason}`);
        const run = startRun(db, { competitorId: job.competitorId, ...scheduledPreset(opts.now) }); // throws "already running"
        const result = await executeRun(db, run.id, (e) => log(`[${e.stage}] ${e.message}`, e.level ?? "info"), opts.client);
        return finish(db, job.id, result.status === "done" ? "done" : "failed", result.error ?? undefined);
      }
      case "discovery": {
        if (!getSetting(db, "discovery.enabled")) {
          log("discovery is disabled in Settings");
          return finish(db, job.id, "skipped", "discovery.enabled is false");
        }
        const now = opts.now ?? new Date();
        const competitors = job.competitorId
          ? db.select().from(schema.competitors).where(eq(schema.competitors.id, job.competitorId)).all()
          : db.select().from(schema.competitors).all();
        const lastDone = db
          .select({ finishedAt: schema.jobs.finishedAt })
          .from(schema.jobs)
          .where(and(eq(schema.jobs.kind, "discovery"), eq(schema.jobs.status, "done")))
          .orderBy(desc(schema.jobs.id))
          .get();
        const lookback = getSetting(db, "discovery.lookbackDays") * 86_400_000;
        const since = new Date((lastDone?.finishedAt ? new Date(lastDone.finishedAt).getTime() : now.getTime()) - lookback).toISOString();
        let errors = 0;
        for (const c of competitors) {
          if (env.exaApiKey || opts.exa) {
            const r = await discoverCompetitor(db, c.id, { since, until: now.toISOString(), now, fetchImpl: opts.fetchImpl, exa: opts.exa, client: opts.client, log: (m) => log(`${c.slug}: ${m}`) });
            errors += r.errors;
            log(`${c.slug}: discovery ${r.created} new, ${r.rejected} rejected, ${r.capped} capped, ${r.errors} error(s), exa ${r.exaCostUsd.toFixed(3)}`);
          } else {
            log(`${c.slug}: off-domain discovery skipped (EXA_API_KEY not set)`);
          }
          const a = await runAbsenceChecks(db, c.id, { now, fetchImpl: opts.fetchImpl, exa: opts.exa, useExa: Boolean(env.exaApiKey || opts.exa), log: (m) => log(`${c.slug}: ${m}`) });
          errors += a.errors;
          log(`${c.slug}: absence checks ${a.checked} run (${a.found} found, ${a.notFound} not found), ${a.skipped} not due`);
        }
        return finish(db, job.id, errors ? "failed" : "done", errors ? `${errors} error(s); see the log` : undefined);
      }
      case "backfill": {
        if (!job.competitorId) return finish(db, job.id, "failed", "backfill jobs need a competitor");
        const payload = job.payload as { months?: number; step?: BackfillStep; withDiscovery?: boolean };
        const r = await runBackfill(db, job.competitorId, {
          months: payload.months ?? 24,
          step: payload.step ?? "quarter",
          withDiscovery: payload.withDiscovery ?? false,
          now: opts.now,
          fetchImpl: opts.fetchImpl,
          exa: opts.exa,
          client: opts.client,
          log: (m) => log(m),
          onProgress: (progress) => db.update(schema.jobs).set({ payload: { ...payload, progress } }).where(eq(schema.jobs.id, job.id)).run(),
        });
        return finish(db, job.id, r.stopped ? "failed" : "done", r.stopped ? `stopped after repeated run failures (${r.runsFailed} failed)` : undefined);
      }
      case "digest": {
        const sender = opts.sender ?? new ResendSender();
        const r = await runDigestJob(db, { sender, now: opts.now, fetchImpl: opts.fetchImpl, log: (m) => log(m) });
        if (r.status === "sent" || r.status === "noop") return finish(db, job.id, r.status === "noop" ? "skipped" : "done", r.status === "noop" ? r.reasons.join("; ") : undefined);
        return finish(db, job.id, "failed", `digest ${r.status}: ${r.reasons.join("; ")}`);
      }
      case "backup": {
        const r = await runBackup(db, opts);
        log(`Backup written to ${path.relative(process.cwd(), r.file)}${r.pruned.length ? `; pruned ${r.pruned.length} old file(s)` : ""}`);
        return finish(db, job.id, "done");
      }
      default:
        return finish(db, job.id, "failed", `${job.kind} jobs are not implemented yet`);
    }
  } catch (e) {
    const message = (e as Error).message;
    log(message, "error");
    return finish(db, job.id, "failed", message);
  }
}
