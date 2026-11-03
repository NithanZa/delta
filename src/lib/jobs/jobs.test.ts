import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema } from "@/db";
import { hashContent, insertSnapshotRecord } from "@/lib/ingest/snapshot";
import { MockLlmClient } from "@/lib/llm/mock";
import { nextRun, scheduledPreset } from "@/lib/pipeline/presets";
import { executeRun, startRun } from "@/lib/pipeline/run";
import { getSchedule, getSetting, setSetting, validateCron, validateTimezone } from "@/lib/settings";
import { claimNext, enqueue, failStaleRunning, finish, listJobs, recoverInterruptedJobs } from "./queue";
import { pendingWorkReason, runBackup, runJob } from "./run";
import { createSchedules, describeNextRuns } from "./worker";

const page = (plan: string, price: number) =>
  `Buffer pricing. The ${plan} plan starts at $${price} per month for up to 10 channels. Any additional channels cost extra each month. The Team plan includes unlimited users and approval workflows for every channel.`;

function setup(opts: { seeded?: boolean } = {}) {
  const db = createDb(":memory:");
  db.insert(schema.company).values({ name: "Loop", product: "Scheduling for agencies" }).run();
  const comp = db.insert(schema.competitors).values({ name: "Buffer", slug: "buffer", website: "https://buffer.com", domain: "buffer.com" }).returning().get();
  db.insert(schema.researchQuestions).values({ competitorId: comp.id, text: "Are they investing in agencies?" }).run();
  const add = (text: string, publishedAt: string) =>
    insertSnapshotRecord(db, comp.id, {
      url: "https://buffer.com/pricing",
      sourceType: "pricing",
      provider: opts.seeded === false ? "manual_url" : "seeded",
      title: `Pricing ${publishedAt}`,
      publishedAt,
      fetchedAt: "2026-10-31T00:00:00.000Z",
      archiveUrl: null,
      rawHtml: "",
      extractedText: text,
      contentHash: hashContent(text),
    }).snapshot;
  return { db, comp, add };
}

describe("job queue", () => {
  it("claims the oldest queued job first and finishes it", () => {
    const { db, comp } = setup();
    const a = enqueue(db, { kind: "crawl", requestedBy: "schedule" });
    const b = enqueue(db, { kind: "run", competitorId: comp.id, requestedBy: "ui" });
    const claimed = claimNext(db)!;
    expect(claimed.id).toBe(a.id);
    expect(claimed.status).toBe("running");
    expect(claimed.startedAt).not.toBeNull();
    expect(claimNext(db)!.id).toBe(b.id);
    expect(claimNext(db)).toBeUndefined();
    const done = finish(db, a.id, "done");
    expect(done.status).toBe("done");
    expect(done.finishedAt).not.toBeNull();
    expect(listJobs(db).map((j) => j.id)).toEqual([b.id, a.id]);
  });

  it("fails jobs left running by a dead worker", () => {
    const { db } = setup();
    const a = enqueue(db, { kind: "backup", requestedBy: "cli" });
    claimNext(db);
    db.update(schema.jobs).set({ startedAt: "2026-01-01T00:00:00.000Z" }).where(eq(schema.jobs.id, a.id)).run();
    expect(failStaleRunning(db, 60_000)).toBe(1);
    expect(listJobs(db)[0]).toMatchObject({ status: "failed", error: "Worker stopped while this job was running" });
  });
});

describe("worker restart recovery", () => {
  it("re-queues interrupted runs and backfills, fails other jobs, and releases their runs so a restart can proceed at once", () => {
    const { db, comp, add } = setup();
    const { id: snapId } = add(page("Agency", 120), "2023-06-17");
    const backfill = enqueue(db, { kind: "backfill", competitorId: comp.id, requestedBy: "ui" });
    claimNext(db);
    const crawl = enqueue(db, { kind: "crawl", requestedBy: "schedule" });
    claimNext(db);
    const weekly = enqueue(db, { kind: "run", competitorId: comp.id, requestedBy: "schedule" });
    claimNext(db);
    const orphan = startRun(db, { competitorId: comp.id, label: "Backfill ≤ 2024-12-31", cutoffDate: "2024-12-31", kind: "backfill" });
    db.update(schema.runs).set({ status: "running", startedAt: new Date().toISOString() }).where(eq(schema.runs.id, orphan.id)).run();
    db.update(schema.snapshots).set({ processedRunId: orphan.id }).where(eq(schema.snapshots.id, snapId)).run();
    expect(() => startRun(db, { competitorId: comp.id, label: "x", cutoffDate: "2025-01-01" })).toThrow(/already running/);

    expect(recoverInterruptedJobs(db)).toEqual({ requeued: 2, failed: 1, runsReleased: 1 });
    const jobs = listJobs(db);
    expect(jobs.find((j) => j.id === weekly.id)).toMatchObject({ status: "queued", startedAt: null });
    expect(jobs.find((j) => j.id === backfill.id)).toMatchObject({ status: "queued", startedAt: null });
    expect(jobs.find((j) => j.id === crawl.id)).toMatchObject({ status: "failed" });
    expect(db.select().from(schema.runs).where(eq(schema.runs.id, orphan.id)).get()).toMatchObject({ status: "failed" });
    expect(db.select().from(schema.snapshots).where(eq(schema.snapshots.id, snapId)).get()?.processedRunId).toBeNull();
    expect(startRun(db, { competitorId: comp.id, label: "x", cutoffDate: "2025-01-01" }).status).toBe("queued");
  });
});

describe("run jobs", () => {
  it("skips when nothing is new, runs when pages are pending, and runs again for a pending correction", async () => {
    const { db, comp, add } = setup();
    add(page("Agency", 120), "2023-06-17");
    const client = new MockLlmClient();
    // Nothing processed yet → pending page → a scheduled run.
    let job = await runJob(db, enqueue(db, { kind: "run", competitorId: comp.id, requestedBy: "schedule" }), { client, now: new Date("2026-11-03T05:00:00Z") });
    expect(job.status).toBe("done");
    const run = db.select().from(schema.runs).get()!;
    expect(run).toMatchObject({ kind: "scheduled", label: "Week of 2026-11-03", status: "done" });
    expect(job.log.some((l) => /\[finalize\]/.test(l.message))).toBe(true);

    // Nothing new → skipped with a reason.
    expect(pendingWorkReason(db, comp.id)).toBeNull();
    job = await runJob(db, enqueue(db, { kind: "run", competitorId: comp.id, requestedBy: "ui" }), { client });
    expect(job.status).toBe("skipped");
    expect(job.error).toMatch(/nothing new since Week of 2026-11-03/);
    expect(db.select().from(schema.runs).all()).toHaveLength(1);

    // A pending correction forces a run even without new pages.
    const h = db.select().from(schema.hypotheses).get()!;
    db.update(schema.hypotheses).set({ userCorrection: "Only true for agencies with 10+ clients", correctionAppliedRunId: null }).where(eq(schema.hypotheses.id, h.id)).run();
    expect(pendingWorkReason(db, comp.id)).toMatch(/1 pending correction/);
    job = await runJob(db, enqueue(db, { kind: "run", competitorId: comp.id, requestedBy: "ui" }), { client });
    expect(job.status).toBe("done");
    expect(db.select().from(schema.runs).all()).toHaveLength(2);
  });

  it("fails cleanly when a run is already in flight", async () => {
    const { db, comp, add } = setup();
    add(page("Agency", 120), "2023-06-17");
    const active = startRun(db, { competitorId: comp.id, label: "Manual", cutoffDate: "2026-11-03", kind: "manual" });
    db.update(schema.runs).set({ status: "running", startedAt: new Date().toISOString() }).where(eq(schema.runs.id, active.id)).run(); // in flight
    const job = await runJob(db, enqueue(db, { kind: "run", competitorId: comp.id, requestedBy: "schedule" }), { client: new MockLlmClient() });
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/already running/);
  });

  it("crawl jobs call the crawler per competitor", async () => {
    const { db, comp } = setup();
    db.update(schema.sources).set({ watch: true }).run();
    const fetchImpl = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    const job = await runJob(db, enqueue(db, { kind: "crawl", competitorId: comp.id, requestedBy: "cli" }), { fetchImpl });
    expect(job.status).toBe("done"); // no watched sources yet → nothing checked, no errors
  });

  it("backup copies the database file and keeps at most the configured number", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "delta-backups-"));
    const dbPath = path.join(dir, "live.db");
    const db = createDb(dbPath);
    db.insert(schema.company).values({ name: "Loop" }).run();
    for (let i = 0; i < 4; i++) {
      await runBackup(db, { backupDir: dir, keepBackups: 3, now: new Date(Date.UTC(2026, 10, 1 + i, 2)) });
    }
    const files = fs.readdirSync(dir).filter((f) => /^delta-.*\.db$/.test(f)).sort();
    expect(files).toHaveLength(3);
    expect(files[0]).toContain("2026-11-02");
    const copy = createDb(path.join(dir, files[2]));
    expect(copy.select().from(schema.company).get()?.name).toBe("Loop");
    const job = await runJob(db, enqueue(db, { kind: "backup", requestedBy: "ui" }), { backupDir: dir, keepBackups: 3 });
    expect(job.status).toBe("done");
    expect(fs.readdirSync(dir).filter((f) => /^delta-.*\.db$/.test(f))).toHaveLength(3);
  });
});

describe("backfill jobs", () => {
  it("run through the worker path, reporting cutoffs done/total in the job payload for the progress panel", async () => {
    const { db, comp } = setup({ seeded: false });
    db.insert(schema.sources).values({ competitorId: comp.id, url: "https://buffer.com/plans", sourceType: "pricing", provider: "watchlist", watch: true }).run();
    const html = `<html><head><title>Plans</title></head><body><main>${`<p>${page("Agency", 100)}</p>`.repeat(6)}</main></body></html>`;
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/cdx/search/cdx")) return new Response(JSON.stringify([["timestamp", "original", "statuscode", "digest"], ["20260801000000", "https://buffer.com/plans", "200", "AAA"]]), { status: 200 });
      if (url.startsWith("https://web.archive.org/web/20260801000000id_/")) return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;
    const job = await runJob(db, enqueue(db, { kind: "backfill", competitorId: comp.id, requestedBy: "ui", payload: { months: 6, step: "quarter" } }), { now: new Date("2026-11-03T00:00:00Z"), fetchImpl, client: new MockLlmClient() });
    expect(job.status).toBe("done");
    const stored = listJobs(db).find((j) => j.id === job.id)!;
    expect(stored.payload).toMatchObject({ months: 6, progress: { stage: "finished", cutoffsDone: 2, cutoffsTotal: 2, pagesFetched: 1 } });
    expect(db.select().from(schema.runs).all().map((r) => [r.kind, r.cutoffDate, r.status])).toEqual([["backfill", "2026-09-30", "done"]]);
    expect(listJobs(db).some((j) => j.kind === "run" && j.status === "queued")).toBe(true);
  }, 15000);
});

describe("presets", () => {
  it("replays the dated presets for seeded competitors, then dates runs today; live competitors start at Run 1 today", async () => {
    const { db, comp, add } = setup();
    add(page("Agency", 120), "2023-06-17");
    expect(nextRun(db, comp.id)).toMatchObject({ kind: "replay", label: "Run 1", cutoffDate: "2023-12-31" });
    const client = new MockLlmClient();
    for (let i = 0; i < 3; i++) await executeRun(db, startRun(db, { competitorId: comp.id, ...nextRun(db, comp.id) }).id, () => {}, client);
    const after = nextRun(db, comp.id);
    expect(after.kind).toBe("manual");
    expect(after.label).toBe("Run 4");
    expect(scheduledPreset(new Date("2026-11-03T05:00:00Z"))).toEqual({ kind: "scheduled", label: "Week of 2026-11-03", cutoffDate: "2026-11-03" });

    const live = setup({ seeded: false });
    live.add(page("Team", 10), "2026-11-01");
    expect(nextRun(live.db, live.comp.id)).toMatchObject({ kind: "manual", label: "Run 1" });
  });
});

describe("settings and schedules", () => {
  it("returns defaults, stores values, and validates cron strings and timezones", () => {
    const { db } = setup();
    expect(getSetting(db, "schedule.runCron")).toBe("0 5 * * MON");
    expect(getSetting(db, "worker.heartbeatAt")).toBeNull();
    setSetting(db, "schedule.runCron", "30 6 * * TUE");
    setSetting(db, "schedule.runCron", "30 7 * * TUE");
    expect(getSchedule(db).runCron).toBe("30 7 * * TUE");
    expect(validateCron("0 5 * * MON")).toBeNull();
    expect(validateCron("@weekly")).toBeNull();
    expect(validateCron("99 5 * * MON")).toMatch(/./);
    expect(validateCron("not a cron")).toMatch(/./);
    expect(validateTimezone("Europe/London")).toBeNull();
    expect(validateTimezone("Mars/Olympus")).toMatch(/Unknown IANA timezone/);
  });

  it("builds paused schedulers whose next runs follow the patterns and timezone", () => {
    const { db } = setup();
    const entries = createSchedules(db, { timezone: "UTC", crawlCron: "0 3 * * *", runCron: "0 5 * * MON", digestCron: "0 8 * * MON", discoveryCron: "0 4 * * MON" }, { paused: true });
    expect(entries.map((e) => e.name)).toEqual(["crawl", "run", "discovery", "digest", "backup"]);
    const run = entries[1].cron.nextRun()!;
    expect(run.getUTCDay()).toBe(1);
    expect(run.getUTCHours()).toBe(5);
    const crawl = entries[0].cron.nextRun()!;
    expect(crawl.getUTCHours()).toBe(3);
    expect(describeNextRuns(entries, "UTC")).toHaveLength(5);
    for (const e of entries) e.cron.stop();
  });
});
