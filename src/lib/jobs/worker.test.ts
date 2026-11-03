import { describe, expect, it } from "vitest";
import { createDb, schema } from "@/db";
import { hashContent, insertSnapshotRecord } from "@/lib/ingest/snapshot";
import type { LlmClient } from "@/lib/llm/client";
import { MockLlmClient } from "@/lib/llm/mock";
import { getSetting, setSetting } from "@/lib/settings";
import { enqueue, listJobs } from "./queue";
import { createSchedules, startWorker } from "./worker";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup() {
  const db = createDb(":memory:");
  db.insert(schema.company).values({ name: "Loop" }).run();
  const comp = db.insert(schema.competitors).values({ name: "Buffer", slug: "buffer", website: "https://buffer.com", domain: "buffer.com" }).returning().get();
  const text = "Buffer pricing. The Agency plan starts at $120 per month for up to 10 channels. Any additional channels cost extra each month. The Team plan includes unlimited users.";
  insertSnapshotRecord(db, comp.id, { url: "https://buffer.com/pricing", sourceType: "pricing", provider: "seeded", title: "Pricing", publishedAt: "2023-06-17", fetchedAt: "2026-10-31T00:00:00.000Z", archiveUrl: null, rawHtml: "", extractedText: text, contentHash: hashContent(text) });
  return { db, comp };
}

describe("createSchedules", () => {
  it("really fires: a due cron tick enqueues its job", async () => {
    const { db } = setup();
    const entries = createSchedules(db, { timezone: "UTC", crawlCron: "* * * * * *", runCron: "0 5 * * MON", digestCron: "0 8 * * MON", discoveryCron: "0 4 * * MON" });
    await sleep(1300);
    for (const e of entries) e.cron.stop();
    const jobs = listJobs(db);
    expect(jobs.length).toBeGreaterThanOrEqual(1);
    expect(jobs.every((j) => j.kind === "crawl" && j.requestedBy === "schedule" && j.status === "queued")).toBe(true);
  });
});

describe("startWorker", () => {
  it("writes a heartbeat, claims queued jobs, waits for the running job on stop, and reschedules on settings changes", async () => {
    const { db, comp } = setup();
    const lines: string[] = [];
    // A slow model so the run is still in flight when stop() is called.
    const mock = new MockLlmClient();
    const client: LlmClient = {
      async complete(req) {
        if (req.task === "synthesize") await sleep(300);
        return mock.complete(req);
      },
    };
    const worker = startWorker(db, { client, pollMs: 20, heartbeatMs: 50, rescheduleMs: 30, log: (m) => lines.push(m) });
    expect(getSetting(db, "worker.heartbeatAt")).not.toBeNull();
    expect(lines.some((l) => /^run\s+0 5 \* \* MON\s+next/.test(l))).toBe(true);

    const job = enqueue(db, { kind: "run", competitorId: comp.id, requestedBy: "ui" });
    await sleep(80); // claimed by the poll loop
    expect(listJobs(db).find((j) => j.id === job.id)?.status).toBe("running");

    setSetting(db, "schedule.runCron", "15 6 * * TUE");
    await sleep(80);
    expect(lines.some((l) => /rescheduled \(runCron changed\)/.test(l))).toBe(true);
    expect(worker.entries()[1].pattern).toBe("15 6 * * TUE");

    await worker.stop(); // waits for the job
    const done = listJobs(db).find((j) => j.id === job.id)!;
    expect(done.status).toBe("done");
    expect(db.select().from(schema.runs).get()?.status).toBe("done");
    expect(getSetting(db, "worker.heartbeatAt")).toBeNull();
    expect(lines.some((l) => /waiting for the current job/.test(l))).toBe(true);
  });
});
