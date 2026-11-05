/**
 * The worker's schedules and loop, separated from the process entry point so
 * tests can build the schedulers paused and assert their next run times.
 */
import { Cron } from "croner";
import type { Db } from "@/db";
import { schema } from "@/db";
import { checkBudget } from "@/lib/budget";
import { getSchedule, setSetting, type Schedule } from "@/lib/settings";
import { claimNext, enqueue, recoverInterruptedJobs } from "./queue";
import { runJob, type JobRunnerOptions } from "./run";

export type ScheduleEntry = { name: string; pattern: string; cron: Cron };

/**
 * Build the cron schedulers. Each tick enqueues work; the loop runs one job at
 * a time, so ticks never overlap a running job (`protect` guards the callback itself).
 */
export function createSchedules(db: Db, schedule: Schedule, opts: { paused?: boolean; log?: (m: string) => void } = {}): ScheduleEntry[] {
  const log = opts.log ?? (() => {});
  const make = (name: string, pattern: string, fn: () => void): ScheduleEntry => ({
    name,
    pattern,
    cron: new Cron(pattern, { name: `delta-${name}`, timezone: schedule.timezone, protect: true, paused: opts.paused, catch: (e) => log(`${name} tick failed: ${(e as Error).message}`) }, fn),
  });
  return [
    make("crawl", schedule.crawlCron, () => {
      enqueue(db, { kind: "crawl", requestedBy: "schedule" });
      log("scheduled crawl enqueued");
    }),
    make("run", schedule.runCron, () => {
      for (const c of db.select().from(schema.competitors).all()) enqueue(db, { kind: "run", competitorId: c.id, requestedBy: "schedule" });
      log("scheduled runs enqueued");
    }),
    make("discovery", schedule.discoveryCron, () => {
      enqueue(db, { kind: "discovery", requestedBy: "schedule" });
      log("scheduled discovery enqueued");
    }),
    make("digest", schedule.digestCron, () => {
      enqueue(db, { kind: "digest", requestedBy: "schedule" });
      log("scheduled digest enqueued");
    }),
    make("backup", "0 2 * * *", () => {
      enqueue(db, { kind: "backup", requestedBy: "schedule" });
      log("scheduled backup enqueued");
    }),
  ];
}

export function describeNextRuns(entries: ScheduleEntry[], timezone: string): string[] {
  return entries.map((e) => {
    const next = e.cron.nextRun();
    return `${e.name.padEnd(7)} ${e.pattern.padEnd(14)} next ${next ? next.toLocaleString("en-GB", { timeZone: timezone, hour12: false }) : "never"} (${timezone})`;
  });
}

export type WorkerOptions = JobRunnerOptions & {
  pollMs?: number;
  heartbeatMs?: number;
  rescheduleMs?: number;
  log?: (m: string) => void;
};

/** Runs until `stop()` resolves; claims queued jobs, keeps the heartbeat and reschedules on settings changes. */
export function startWorker(db: Db, opts: WorkerOptions = {}) {
  const log = opts.log ?? ((m: string) => console.log(`${new Date().toISOString()} ${m}`));
  const pollMs = opts.pollMs ?? 20_000;
  let schedule = getSchedule(db);
  let entries = createSchedules(db, schedule, { log });
  let current: Promise<unknown> | null = null;
  let stopping = false;

  const recovered = recoverInterruptedJobs(db);
  if (recovered.requeued || recovered.failed) log(`recovered after restart: ${recovered.requeued} job(s) re-queued, ${recovered.failed} failed, ${recovered.runsReleased} run(s) released`);
  setSetting(db, "worker.heartbeatAt", new Date().toISOString());
  for (const line of describeNextRuns(entries, schedule.timezone)) log(line);

  const heartbeat = setInterval(() => setSetting(db, "worker.heartbeatAt", new Date().toISOString()), opts.heartbeatMs ?? 60_000);
  const reschedule = setInterval(() => {
    const next = getSchedule(db);
    const changed = (Object.keys(next) as (keyof Schedule)[]).filter((k) => next[k] !== schedule[k]);
    if (changed.length === 0) return;
    for (const e of entries) e.cron.stop();
    schedule = next;
    entries = createSchedules(db, schedule, { log });
    log(`rescheduled (${changed.join(", ")} changed)`);
    for (const line of describeNextRuns(entries, schedule.timezone)) log(line);
  }, opts.rescheduleMs ?? 5 * 60_000);

  const tick = async () => {
    if (stopping || current) return;
    const job = claimNext(db);
    if (!job) return;
    log(`job #${job.id} ${job.kind}${job.competitorId ? ` competitor ${job.competitorId}` : ""} (${job.requestedBy}) started`);
    current = runJob(db, job, opts)
      .then((done) => log(`job #${done.id} ${done.kind} ${done.status}${done.error ? `: ${done.error}` : ""}`))
      .catch((e) => log(`job #${job.id} crashed: ${(e as Error).message}`))
      .then(() => checkBudget(db, { sender: opts.sender, now: opts.now, log }))
      .catch((e) => log(`budget check failed: ${(e as Error).message}`))
      .finally(() => {
        current = null;
      });
    await current;
  };
  const poll = setInterval(() => void tick(), pollMs);
  void tick();

  return {
    entries: () => entries,
    /** Stop scheduling, wait for the current job, clear timers. */
    async stop() {
      stopping = true;
      for (const e of entries) e.cron.stop();
      clearInterval(poll);
      clearInterval(reschedule);
      clearInterval(heartbeat);
      if (current) {
        log("waiting for the current job to finish…");
        await current;
      }
      setSetting(db, "worker.heartbeatAt", null);
    },
  };
}
