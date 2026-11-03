import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema } from "@/db";
import { hashContent, insertSnapshotRecord } from "@/lib/ingest/snapshot";
import { MockLlmClient } from "@/lib/llm/mock";
import { nextRun } from "@/lib/pipeline/presets";
import { executeRun, startRun } from "@/lib/pipeline/run";
import { buildDigestContent, isQuiet, periodSincePreviousRun } from "./content";

const page = (plan: string, price: number) =>
  `Buffer pricing. The ${plan} plan starts at $${price} per month for up to 10 channels. Any additional channels cost extra each month. The Team plan includes unlimited users and approval workflows for every channel.`;

async function setupTwoRuns() {
  const db = createDb(":memory:");
  db.insert(schema.company).values({ name: "Loop", priorities: "Win agencies" }).run();
  const comp = db.insert(schema.competitors).values({ name: "Buffer", slug: "buffer", website: "https://buffer.com", domain: "buffer.com" }).returning().get();
  db.insert(schema.researchQuestions).values({ competitorId: comp.id, text: "Are they investing in agencies?" }).run();
  const add = (text: string, publishedAt: string) =>
    insertSnapshotRecord(db, comp.id, {
      url: "https://buffer.com/pricing",
      sourceType: "pricing",
      provider: "seeded",
      title: `Pricing ${publishedAt}`,
      publishedAt,
      fetchedAt: "2026-10-31T00:00:00.000Z",
      archiveUrl: null,
      rawHtml: "",
      extractedText: text,
      contentHash: hashContent(text),
    });
  add(page("Agency", 120), "2023-06-17");
  add(page("Agency", 100), "2024-08-16");
  const client = new MockLlmClient();
  const r1 = await executeRun(db, startRun(db, { competitorId: comp.id, ...nextRun(db, comp.id) }).id, () => {}, client);
  // Make the periods distinct and deterministic.
  db.update(schema.runs).set({ finishedAt: "2026-11-01T10:00:00.000Z" }).where(eq(schema.runs.id, r1.id)).run();
  const r2 = await executeRun(db, startRun(db, { competitorId: comp.id, ...nextRun(db, comp.id) }).id, () => {}, client);
  db.update(schema.runs).set({ finishedAt: "2026-11-08T10:00:00.000Z" }).where(eq(schema.runs.id, r2.id)).run();
  // The crawler touched two pages in the second period, one of them changed.
  db.update(schema.sources).set({ lastCheckedAt: "2026-11-05T03:00:00.000Z", lastChangedAt: "2026-11-05T03:00:00.000Z" }).run();
  return { db, comp, r1, r2 };
}

describe("digest content model", () => {
  it("reports what the runs in the period changed, selects top insights, and counts crawled pages", async () => {
    const { db, comp, r2 } = await setupTwoRuns();
    const period = periodSincePreviousRun(db, comp.id)!;
    expect(period).toEqual({ since: "2026-11-01T10:00:00.000Z", until: "2026-11-08T10:00:00.000Z" });
    const content = buildDigestContent(db, period);
    expect(content.company?.name).toBe("Loop");
    expect(content.competitors).toHaveLength(1);
    const c = content.competitors[0];
    expect(c.runs.map((r) => r.id)).toEqual([r2.id]);
    expect(c.hypothesesMoved).toHaveLength(1);
    expect(c.hypothesesMoved[0]).toMatchObject({ change: "strengthened", prev: 0.5, next: 0.7 });
    expect(c.topInsights).toHaveLength(1);
    expect(c.topInsights[0].runId).toBe(r2.id);
    expect(c.topInsights[0].score).toBeGreaterThanOrEqual(0.45);
    expect(c.changes).toHaveLength(1);
    expect(c.changes[0].previousSnapshot?.publishedAt).toBe("2023-06-17");
    expect(c.questionsResolved).toHaveLength(1);
    expect(c.questionsRaised).toHaveLength(1);
    expect(c.pagesChecked).toBe(1);
    expect(c.pagesChanged).toBe(1);
    expect(content.quiet).toBe(false);
  });

  it("is quiet for a period with no runs and respects the thresholds", async () => {
    const { db } = await setupTwoRuns();
    const empty = buildDigestContent(db, { since: "2026-11-08T10:00:00.000Z", until: "2026-11-15T10:00:00.000Z" });
    expect(empty.competitors[0].runs).toHaveLength(0);
    expect(empty.competitors[0].topInsights).toHaveLength(0);
    expect(empty.quiet).toBe(true);
    const c = empty.competitors[0];
    expect(isQuiet([{ ...c, hypothesesMoved: [{ ...c.hypothesesMoved[0], prev: 0.5, next: 0.55 } as never] }])).toBe(true);
    expect(isQuiet([{ ...c, hypothesesMoved: [{ prev: 0.5, next: 0.6 } as never] }])).toBe(false);
    expect(isQuiet([{ ...c, changes: [{ fact: { importance: 4 } } as never] }])).toBe(false);
    expect(isQuiet([{ ...c, changes: [{ fact: { importance: 3 } } as never] }])).toBe(true);
  });
});
