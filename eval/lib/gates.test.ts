import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, schema } from "@/db";
import { hashContent, insertSnapshotRecord } from "@/lib/ingest/snapshot";
import { exitCodeFor, runGates } from "./gates";

const TEXT = "Buffer pricing. Agency plans start at $120 per month for up to 10 channels. Any additional channels cost $6 per month each. The Team plan includes unlimited users.";

function seed() {
  const db = createDb(":memory:");
  db.insert(schema.company).values({ name: "Loop" }).run();
  const comp = db.insert(schema.competitors).values({ name: "Buffer", slug: "buffer" }).returning().get();
  const { snapshot } = insertSnapshotRecord(db, comp.id, {
    url: "https://buffer.com/pricing",
    sourceType: "pricing",
    provider: "seeded",
    title: "Pricing",
    publishedAt: "2023-06-17",
    fetchedAt: "2026-11-02T00:00:00.000Z",
    archiveUrl: null,
    rawHtml: "",
    extractedText: TEXT,
    contentHash: hashContent(TEXT),
  });
  const run = db.insert(schema.runs).values({ competitorId: comp.id, label: "Run 1", cutoffDate: "2023-12-31", status: "done" }).returning().get();
  const fact = db
    .insert(schema.facts)
    .values({
      runId: run.id,
      competitorId: comp.id,
      snapshotId: snapshot.id,
      statement: "Buffer lists an Agency plan at $120 per month for up to 10 channels.",
      quote: "Agency plans start at $120 per month for up to 10 channels.",
      category: "pricing",
      eventDate: "2023-06-17",
      importance: 4,
    })
    .returning()
    .get();
  const hyp = db
    .insert(schema.hypotheses)
    .values({ competitorId: comp.id, dimension: "customers", statement: "Buffer is investing in agencies.", confidence: 0.6, createdRunId: run.id, updatedRunId: run.id })
    .returning()
    .get();
  db.insert(schema.hypothesisUpdates).values({ hypothesisId: hyp.id, runId: run.id, change: "created", newConfidence: 0.6, reasoning: "r", factIds: [fact.id] }).run();
  db.insert(schema.insights)
    .values({
      competitorId: comp.id,
      runId: run.id,
      title: "t",
      whatHappened: "a",
      whatItMeans: "b",
      whyItMatters: "c",
      whatToDoNext: "d",
      severity: "high",
      hypothesisIds: [hyp.id],
      factIds: [fact.id],
      actions: [],
    })
    .run();
  return { db, comp, run, snapshot, fact, hyp };
}

describe("trust gates", () => {
  it("pass on a consistent record", () => {
    const { db } = seed();
    const report = runGates(db);
    expect(report.passed).toBe(true);
    expect(exitCodeFor(report)).toBe(0);
    expect(report.results.map((r) => r.id)).toEqual(["G1", "G2", "G3", "G4", "G5"]);
  });

  it("G1 fails with exit code 1 when a quote is tampered", () => {
    const { db, fact } = seed();
    db.update(schema.facts).set({ quote: "Agency plans start at $99 per month for up to 50 channels." }).where(eq(schema.facts.id, fact.id)).run();
    const report = runGates(db);
    expect(report.passed).toBe(false);
    expect(exitCodeFor(report)).toBe(1);
    const g1 = report.results.find((r) => r.id === "G1")!;
    expect(g1.violations).toEqual([`F${fact.id}`]);
  });

  it("G2 fails when a fact's page is dated after its run cutoff", () => {
    const { db, run } = seed();
    db.update(schema.runs).set({ cutoffDate: "2023-01-01" }).where(eq(schema.runs.id, run.id)).run();
    const g2 = runGates(db).results.find((r) => r.id === "G2")!;
    expect(g2.violations.length).toBeGreaterThan(0);
    expect(g2.violations[0]).toMatch(/^F\d+ \(2023-06-17 > 2023-01-01\)/);
  });

  it("G3, G4 and G5 catch dangling ids, bad confidences and missing citations", () => {
    const { db, hyp, fact } = seed();
    db.update(schema.hypotheses).set({ confidence: 1 }).where(eq(schema.hypotheses.id, hyp.id)).run();
    db.update(schema.insights).set({ factIds: [fact.id + 999], hypothesisIds: [] }).run();
    db.update(schema.hypothesisUpdates).set({ factIds: [] }).run();
    const byId = Object.fromEntries(runGates(db).results.map((r) => [r.id, r.violations]));
    expect(byId.G3.some((v) => v.includes(`F${fact.id + 999}`))).toBe(true);
    expect(byId.G4).toContain(`H${hyp.id} confidence 1`);
    expect(byId.G5.some((v) => v.startsWith("I"))).toBe(false); // insight still cites a fact id (even if dangling)
    expect(byId.G5.some((v) => v.startsWith("HU"))).toBe(true);
  });
});
