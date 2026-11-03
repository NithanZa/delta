/**
 * A small SQLite-backed job queue shared by the web process (which enqueues)
 * and the worker (which claims and runs). One job runs at a time.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { Job, JobKind, JobRequester, JobStatus, RunLogEntry } from "@/db/schema";
import { releaseOrphanedRuns } from "@/lib/pipeline/run";

export type EnqueueArgs = { kind: JobKind; competitorId?: number | null; payload?: Record<string, unknown>; requestedBy: JobRequester };

export function enqueue(db: Db, args: EnqueueArgs): Job {
  return db
    .insert(schema.jobs)
    .values({ kind: args.kind, competitorId: args.competitorId ?? null, payload: args.payload ?? {}, requestedBy: args.requestedBy, status: "queued" })
    .returning()
    .get();
}

/** Oldest queued job → running, in one transaction so two workers never claim the same job. */
export function claimNext(db: Db): Job | undefined {
  return db.transaction((tx) => {
    const next = tx.select().from(schema.jobs).where(eq(schema.jobs.status, "queued")).orderBy(asc(schema.jobs.id)).get();
    if (!next) return undefined;
    return tx
      .update(schema.jobs)
      .set({ status: "running", startedAt: new Date().toISOString() })
      .where(and(eq(schema.jobs.id, next.id), eq(schema.jobs.status, "queued")))
      .returning()
      .get();
  });
}

export function appendLog(db: Db, jobId: number, entry: Omit<RunLogEntry, "ts"> & { ts?: string }): void {
  const job = db.select({ log: schema.jobs.log }).from(schema.jobs).where(eq(schema.jobs.id, jobId)).get();
  if (!job) return;
  const log = [...job.log, { ts: entry.ts ?? new Date().toISOString(), level: entry.level, message: entry.message }];
  db.update(schema.jobs).set({ log }).where(eq(schema.jobs.id, jobId)).run();
}

export function finish(db: Db, jobId: number, status: Extract<JobStatus, "done" | "failed" | "skipped">, error?: string): Job {
  return db
    .update(schema.jobs)
    .set({ status, error: error ?? null, finishedAt: new Date().toISOString() })
    .where(eq(schema.jobs.id, jobId))
    .returning()
    .get();
}

export function listJobs(db: Db, limit = 50): Job[] {
  return db.select().from(schema.jobs).orderBy(desc(schema.jobs.id)).limit(limit).all();
}

export function getJob(db: Db, id: number): Job | undefined {
  return db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get();
}

/**
 * On worker start, every `running` job was orphaned by the previous worker.
 * Their in-flight runs are released. Runs and backfills go back in the queue
 * (a reboot during the weekly run must not cost a week; a backfill resumes at
 * its first unfinished cutoff). Everything else is failed and runs on its next schedule.
 */
export function recoverInterruptedJobs(db: Db): { requeued: number; failed: number; runsReleased: number } {
  const running = db.select().from(schema.jobs).where(eq(schema.jobs.status, "running")).all();
  const result = { requeued: 0, failed: 0, runsReleased: 0 };
  for (const j of running) {
    if (j.competitorId !== null && (j.kind === "run" || j.kind === "backfill")) {
      result.runsReleased += releaseOrphanedRuns(db, j.competitorId, j.kind === "run" ? ["scheduled"] : ["backfill"], "Worker stopped while this run was in progress");
    }
    if (j.kind === "backfill" || j.kind === "run") {
      db.update(schema.jobs).set({ status: "queued", startedAt: null }).where(eq(schema.jobs.id, j.id)).run();
      appendLog(db, j.id, { level: "warn", message: `Worker restarted; this ${j.kind} was re-queued` });
      result.requeued++;
    } else {
      finish(db, j.id, "failed", "Worker stopped while this job was running");
      result.failed++;
    }
  }
  return result;
}

/** Jobs left `running` by a crashed worker are failed so the queue does not stall. */
export function failStaleRunning(db: Db, olderThanMs: number, now = new Date()): number {
  const running = db.select().from(schema.jobs).where(eq(schema.jobs.status, "running")).all();
  let n = 0;
  for (const j of running) {
    const started = j.startedAt ? new Date(j.startedAt).getTime() : 0;
    if (now.getTime() - started > olderThanMs) {
      finish(db, j.id, "failed", "Worker stopped while this job was running");
      n++;
    }
  }
  return n;
}
