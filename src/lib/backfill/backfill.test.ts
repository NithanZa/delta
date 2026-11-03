import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema } from "@/db";
import { hashContent, insertSnapshotRecord } from "@/lib/ingest/snapshot";
import { CdxBudget, listCaptures, parseCdx, pickCaptureBefore, type Capture } from "@/lib/ingest/wayback";
import { MockLlmClient } from "@/lib/llm/mock";
import { periodEnds, planBackfill } from "./plan";
import { doneBackfillCutoffs, runBackfill } from "./run";

const CDX = [
  ["timestamp", "original", "statuscode", "digest"],
  ["20230617041020", "https://www.socialpilot.co/plans", "200", "AAA"],
  ["20231105000000", "https://www.socialpilot.co/plans", "200", "AAA"],
  ["20240301000000", "https://www.socialpilot.co/plans", "200", "BBB"],
  ["20250108000000", "https://www.socialpilot.co/plans", "200", "CCC"],
];

describe("CDX client", () => {
  it("parses the header row and picks the latest capture before a cutoff", () => {
    const caps = parseCdx(CDX);
    expect(caps).toHaveLength(4);
    expect(caps[0]).toEqual({ timestamp: "20230617041020", original: "https://www.socialpilot.co/plans", digest: "AAA", date: "2023-06-17" });
    expect(pickCaptureBefore(caps, "2024-06-30")?.timestamp).toBe("20240301000000");
    expect(pickCaptureBefore(caps, "2023-06-01")).toBeUndefined();
    expect(parseCdx([])).toEqual([]);
  });

  it("sends the documented query, honours Retry-After on 429/503, and respects the budget", async () => {
    const calls: string[] = [];
    let n = 0;
    const fetchImpl = (async (input: string | URL | Request) => {
      calls.push(String(input));
      n++;
      if (n === 1) return new Response("", { status: 503, headers: { "retry-after": "0" } });
      return new Response(JSON.stringify(CDX), { status: 200 });
    }) as unknown as typeof fetch;
    const budget = new CdxBudget(3);
    const caps = await listCaptures("https://www.socialpilot.co/plans", { from: "20230301", to: "20261103", fetchImpl, minGapMs: 0, retryDelayMs: 0, budget });
    expect(caps).toHaveLength(4);
    const u = new URL(calls[0]);
    expect(u.origin + u.pathname).toBe("https://web.archive.org/cdx/search/cdx");
    expect(u.searchParams.get("output")).toBe("json");
    expect(u.searchParams.get("fl")).toBe("timestamp,original,statuscode,digest");
    expect(u.searchParams.get("filter")).toBe("statuscode:200");
    expect(u.searchParams.get("collapse")).toBe("timestamp:6");
    expect(u.searchParams.get("from")).toBe("20230301");
    expect(budget.used).toBe(2);
    await expect(listCaptures("https://x", { fetchImpl, minGapMs: 0, budget: new CdxBudget(0) })).rejects.toThrow(/budget/);
  });
});

describe("plan", () => {
  it("builds ascending quarter ends and one fetch per URL per cutoff, skipping unchanged digests", async () => {
    const now = new Date("2026-11-03T00:00:00Z");
    const quarters = periodEnds(now, 24, "quarter");
    expect(quarters).toHaveLength(8);
    expect(quarters[0]).toBe("2024-12-31");
    expect(quarters[7]).toBe("2026-09-30");
    expect(periodEnds(now, 3, "month")).toEqual(["2026-08-31", "2026-09-30", "2026-10-31"]);

    const db = createDb(":memory:");
    db.insert(schema.company).values({ name: "Loop" }).run();
    const comp = db.insert(schema.competitors).values({ name: "SocialPilot", slug: "socialpilot", website: "https://www.socialpilot.co", domain: "socialpilot.co" }).returning().get();
    db.insert(schema.sources).values({ competitorId: comp.id, url: "https://www.socialpilot.co/plans", sourceType: "pricing", provider: "watchlist", watch: true }).run();
    db.insert(schema.sources).values({ competitorId: comp.id, url: "https://www.socialpilot.co/solutions/agencies", sourceType: "website", provider: "watchlist", watch: true }).run();
    db.insert(schema.sources).values({ competitorId: comp.id, url: "https://www.socialpilot.co/blog", sourceType: "blog", provider: "feed", watch: false }).run();
    const captures: Record<string, Capture[]> = {
      "https://www.socialpilot.co/plans": parseCdx(CDX),
      "https://www.socialpilot.co/solutions/agencies": [{ timestamp: "20240830000000", original: "https://www.socialpilot.co/solutions/agencies", digest: "X", date: "2024-08-30" }],
    };
    const asked: string[] = [];
    const plan = await planBackfill(db, comp.id, {
      now,
      listCapturesImpl: async (url, o) => {
        asked.push(`${url} ${o.from}-${o.to}`);
        return captures[url] ?? [];
      },
    });
    expect(asked).toEqual([`https://www.socialpilot.co/plans 20240901-20261103`, `https://www.socialpilot.co/solutions/agencies 20240901-20261103`]);
    expect(plan.cutoffs.map((c) => c.cutoffDate)).toEqual(quarters);
    // Plans page: BBB chosen at 2024-12-31, unchanged until CCC appears for 2025-03-31, then unchanged.
    expect(plan.cutoffs[0].fetches.map((f) => [f.url, f.timestamp])).toEqual([
      ["https://www.socialpilot.co/plans", "20240301000000"],
      ["https://www.socialpilot.co/solutions/agencies", "20240830000000"],
    ]);
    expect(plan.cutoffs[1].fetches.map((f) => f.timestamp)).toEqual(["20250108000000"]);
    expect(plan.cutoffs[1].skipped.map((s) => s.reason)).toEqual(["unchanged since 2024-08-30 (same digest)"]);
    expect(plan.cutoffs[2].fetches).toEqual([]);
    expect(plan.estimate).toEqual({ pages: 3, runs: 2, cdxCalls: 2 });
  });
});

const page = (plan: string, price: number) =>
  `SocialPilot pricing. The ${plan} plan starts at $${price} per month for up to 10 accounts. Any additional accounts cost extra each month. The Agency plan includes unlimited users and approval workflows.`;

function fixture() {
  const db = createDb(":memory:");
  db.insert(schema.company).values({ name: "Loop", priorities: "Win agencies" }).run();
  const comp = db.insert(schema.competitors).values({ name: "SocialPilot", slug: "socialpilot", website: "https://www.socialpilot.co", domain: "socialpilot.co" }).returning().get();
  db.insert(schema.researchQuestions).values({ competitorId: comp.id, text: "Pricing?" }).run();
  db.insert(schema.sources).values({ competitorId: comp.id, url: "https://www.socialpilot.co/plans", sourceType: "pricing", provider: "watchlist", watch: true }).run();
  const archive: Record<string, string> = {
    "https://web.archive.org/web/20240301000000id_/https://www.socialpilot.co/plans": `<html><head><title>Plans 2024</title></head><body><main>${`<p>${page("Agency", 100)}</p>`.repeat(6)}</main></body></html>`,
    "https://web.archive.org/web/20250108000000id_/https://www.socialpilot.co/plans": `<html><head><title>Plans 2025</title></head><body><main>${`<p>${page("Agency", 120)}</p>`.repeat(6)}</main></body></html>`,
  };
  const fetchImpl = (async (input: string | URL | Request) => {
    const html = archive[String(input)];
    return html ? new Response(html, { status: 200, headers: { "content-type": "text/html" } }) : new Response("nope", { status: 404 });
  }) as unknown as typeof fetch;
  const captures = parseCdx(CDX);
  return { db, comp, fetchImpl, listCapturesImpl: async () => captures };
}

describe("runBackfill", () => {
  it("creates one backfill run per cutoff with new pages, in ascending order, each seeing only its window, then queues a normal run; re-running skips done cutoffs", async () => {
    const { db, comp, fetchImpl, listCapturesImpl } = fixture();
    const now = new Date("2026-11-03T00:00:00Z");
    const client = new MockLlmClient();
    const stages: string[] = [];
    const r = await runBackfill(db, comp.id, { now, fetchImpl, listCapturesImpl, client, onProgress: (p) => stages.push(`${p.stage}:${p.cutoffsDone}/${p.cutoffsTotal}`) });
    expect(r).toMatchObject({ cutoffsTotal: 8, cutoffsDone: 8, pagesFetched: 2, runsFailed: 0, stopped: false, cutoffsSkipped: 0 });
    const runs = db.select().from(schema.runs).where(eq(schema.runs.competitorId, comp.id)).all();
    expect(runs.map((x) => [x.kind, x.cutoffDate, x.status])).toEqual([
      ["backfill", "2024-12-31", "done"],
      ["backfill", "2025-03-31", "done"],
    ]);
    // Each backfill run processed only snapshots dated on or before its cutoff.
    for (const run of runs) {
      const processed = db.select().from(schema.snapshots).where(eq(schema.snapshots.processedRunId, run.id)).all();
      expect(processed.length).toBe(1);
      expect(processed.every((s) => s.publishedAt <= run.cutoffDate)).toBe(true);
    }
    expect(db.select().from(schema.jobs).all().map((j) => [j.kind, j.status])).toEqual([["run", "queued"]]);
    expect(stages[stages.length - 1]).toBe("finished:8/8");
    expect(doneBackfillCutoffs(db, comp.id)).toEqual(new Set(["2024-12-31", "2025-03-31"]));

    const again = await runBackfill(db, comp.id, { now, fetchImpl, listCapturesImpl, client, enqueueRun: false });
    expect(again.cutoffsSkipped).toBe(2);
    expect(db.select().from(schema.runs).where(eq(schema.runs.competitorId, comp.id)).all()).toHaveLength(2);
  });

  it("fails the run (and keeps going) when a capture is mis-dated after its cutoff, stopping after three consecutive failures", async () => {
    const { db, comp, fetchImpl, listCapturesImpl } = fixture();
    // A prior fact that postdates every cutoff makes assertPointInTime throw inside each backfill run.
    const bad = insertSnapshotRecord(db, comp.id, { url: "https://www.socialpilot.co/plans", sourceType: "pricing", provider: "watchlist", title: "Future", publishedAt: "2026-10-31", fetchedAt: "2026-10-31T00:00:00.000Z", archiveUrl: null, rawHtml: "", extractedText: page("Ultimate", 200), contentHash: hashContent("future") });
    const prior = db.insert(schema.runs).values({ competitorId: comp.id, label: "Run 1", cutoffDate: "2026-10-31", kind: "manual", status: "done" }).returning().get();
    db.update(schema.snapshots).set({ processedRunId: prior.id }).where(eq(schema.snapshots.id, bad.snapshot.id)).run();
    db.insert(schema.facts).values({ runId: prior.id, competitorId: comp.id, snapshotId: bad.snapshot.id, statement: "Future fact", quote: "The Ultimate plan starts at $200 per month", category: "pricing", importance: 3 }).run();
    const r = await runBackfill(db, comp.id, { now: new Date("2026-11-03T00:00:00Z"), fetchImpl, listCapturesImpl, client: new MockLlmClient(), step: "month", months: 24, enqueueRun: false });
    expect(r.runsFailed).toBeGreaterThanOrEqual(1);
    const failed = db.select().from(schema.runs).where(eq(schema.runs.kind, "backfill")).all();
    expect(failed.every((x) => x.status === "failed" && /Point-in-time/.test(x.error ?? ""))).toBe(true);
  });
});
