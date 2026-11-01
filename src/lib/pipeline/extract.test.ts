import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema } from "@/db";
import { MockLlmClient } from "@/lib/stepfun/mock";
import { hashContent, insertSnapshotRecord } from "@/lib/ingest/snapshot";
import { loadCompanyContext } from "./context";
import type { RunEvent } from "./events";
import { runExtraction, selectSnapshotsForRun } from "./extract";
import { quoteIsVerbatim } from "./verbatim";

const PRICING_2023 =
  "Buffer pricing. Agency plans start at $120 per month for up to 10 channels. Any additional channels cost $6 per month each. The Team plan includes unlimited users and approval workflows for every channel.";
const PRICING_2024 =
  "Buffer pricing. Agency plans start at $100 per month for up to 10 channels. Any additional channels cost $5 per month each. The Team plan includes unlimited users and approval workflows for every channel.";
const AGENCY_PAGE =
  "Buffer for Agencies. The platform agencies build their business on. Manage every client from one place and pay only for the channels you use. Client approvals keep each client's work separate and safe.";

function setup() {
  const db = createDb(":memory:");
  db.insert(schema.company).values({ name: "Loop", product: "Scheduling for agencies" }).run();
  const comp = db.insert(schema.competitors).values({ name: "Buffer", slug: "buffer" }).returning().get();
  db.insert(schema.researchQuestions).values({ competitorId: comp.id, text: "Are they investing in agencies?" }).run();
  const rec = (url: string, text: string, publishedAt: string, sourceType: "pricing" | "website" = "pricing") => ({
    url,
    sourceType,
    provider: "seeded" as const,
    title: url,
    publishedAt,
    fetchedAt: "2026-10-31T00:00:00.000Z",
    archiveUrl: null,
    rawHtml: "",
    extractedText: text,
    contentHash: hashContent(text),
  });
  insertSnapshotRecord(db, comp.id, rec("https://buffer.com/pricing", PRICING_2023, "2023-06-17"));
  insertSnapshotRecord(db, comp.id, rec("https://buffer.com/agency", AGENCY_PAGE, "2023-06-03", "website"));
  insertSnapshotRecord(db, comp.id, rec("https://buffer.com/pricing", PRICING_2024, "2024-08-16"));
  const ctx = loadCompanyContext(db, comp.id);
  const mkRun = (label: string, cutoffDate: string) =>
    db.insert(schema.runs).values({ competitorId: comp.id, label, cutoffDate, status: "running" }).returning().get();
  return { db, comp, ctx, mkRun };
}

describe("runExtraction", () => {
  it("extracts verbatim facts for snapshots up to the cutoff and marks them processed", async () => {
    const { db, comp, ctx, mkRun } = setup();
    const client = new MockLlmClient();
    const events: RunEvent[] = [];
    const run1 = mkRun("Run 1", "2023-12-31");

    const r1 = await runExtraction(db, run1, ctx, (e) => events.push(e), client);
    expect(r1.processedSnapshotIds).toHaveLength(2);
    expect(r1.facts.length).toBeGreaterThanOrEqual(4);
    expect(r1.changes).toHaveLength(0);
    for (const f of r1.facts) {
      const snap = db.select().from(schema.snapshots).where(eq(schema.snapshots.id, f.snapshotId)).get();
      expect(quoteIsVerbatim(f.quote, snap!.extractedText)).toBe(true);
      expect(f.runId).toBe(run1.id);
      expect(f.isChange).toBe(false);
    }
    expect(events.find((e) => e.stage === "select")?.data?.count).toBe(2);
    expect(selectSnapshotsForRun(db, comp.id, "2023-12-31")).toHaveLength(0);
    expect(selectSnapshotsForRun(db, comp.id, "2024-12-31")).toHaveLength(1);
  });

  it("only processes new snapshots in Run 2 and flags same-URL changes", async () => {
    const { db, ctx, mkRun } = setup();
    const client = new MockLlmClient();
    await runExtraction(db, mkRun("Run 1", "2023-12-31"), ctx, () => {}, client);
    const run2 = mkRun("Run 2", "2024-12-31");
    const r2 = await runExtraction(db, run2, ctx, () => {}, client);

    expect(r2.processedSnapshotIds).toHaveLength(1);
    expect(r2.changes).toHaveLength(1);
    expect(r2.changes[0].isChange).toBe(true);
    expect(r2.changes[0].statement).toContain("Between 2023-06-17 and 2024-08-16");
    expect(r2.changes[0].runId).toBe(run2.id);
    const changeCalls = client.calls.filter((c) => c.task === "detect_change");
    expect(changeCalls).toHaveLength(1);
    expect(changeCalls[0].user).toContain("(removed) ===");
    expect(changeCalls[0].user).toContain("$120 per month");
    expect(changeCalls[0].user).toContain("$100 per month");
    // Unchanged lines are not sent to the model.
    expect(changeCalls[0].user.split("=== CURRENT VERSION")[0]).not.toContain("approval workflows");
  });

  it("drops facts whose quote is not verbatim and records it in the events", async () => {
    const { db, ctx, mkRun } = setup();
    const client = new MockLlmClient().on("extract_facts", () => ({
      facts: [
        { statement: "real: Agency plan costs $120/month", quote: "Agency plans start at $120 per month for up to 10 channels.", category: "pricing", eventDate: null, importance: 4 },
        { statement: "fake: enterprise push", quote: "Buffer is doubling down on enterprise customers this year.", category: "segment", eventDate: null, importance: 5 },
      ],
    }));
    const events: RunEvent[] = [];
    const r = await runExtraction(db, mkRun("Run 1", "2023-06-17"), ctx, (e) => events.push(e), client);
    // Pricing page keeps "real" and drops "fake"; the agency page (same mock output) drops both.
    expect(r.facts.map((f) => f.statement)).toEqual(["real: Agency plan costs $120/month"]);
    expect(r.dropped).toBe(3);
    expect(events.some((e) => e.level === "warn" && e.message.includes("non-verbatim"))).toBe(true);
  });

  it("skips a snapshot whose extraction throws and continues with the others", async () => {
    const { db, ctx, mkRun } = setup();
    let n = 0;
    const client = new MockLlmClient().on("extract_facts", (req) => {
      n++;
      if (req.user.includes("buffer.com/agency")) throw new Error("boom");
      return { facts: [{ statement: "Agency plan listed at $120 per month", quote: "Agency plans start at $120 per month for up to 10 channels.", category: "pricing", eventDate: null, importance: 3 }] };
    });
    const events: RunEvent[] = [];
    const r = await runExtraction(db, mkRun("Run 1", "2023-12-31"), ctx, (e) => events.push(e), client);
    expect(n).toBe(2);
    expect(r.processedSnapshotIds).toHaveLength(1);
    expect(events.some((e) => e.level === "error" && e.message.startsWith("Skipped"))).toBe(true);
    // The failed snapshot stays pending for the next run.
    expect(db.select().from(schema.snapshots).all().filter((s) => s.processedRunId === null)).toHaveLength(2);
  });
});

describe("quoteIsVerbatim", () => {
  const text = "Agency plans start at $120 per month for up to 10 channels. Any additional channels cost $6 per month.";
  it("accepts exact and whitespace/quote-normalized matches", () => {
    expect(quoteIsVerbatim("Agency plans start at $120 per month", text)).toBe(true);
    expect(quoteIsVerbatim("agency  plans start at $120 per month for up to 10 channels", text)).toBe(true);
  });
  it("accepts near matches with small extraction noise", () => {
    expect(quoteIsVerbatim("Agency plans start at $120 per month for up to 10 channels. Any additional channels cost $6 per month", text + " extra")).toBe(true);
  });
  it("rejects paraphrases and fabrications", () => {
    expect(quoteIsVerbatim("Agency pricing begins at one hundred twenty dollars monthly", text)).toBe(false);
    expect(quoteIsVerbatim("Buffer is doubling down on enterprise", text)).toBe(false);
    expect(quoteIsVerbatim("", text)).toBe(false);
  });
});
