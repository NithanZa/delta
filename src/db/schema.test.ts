import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb } from "./index";
import * as s from "./schema";

describe("schema", () => {
  it("migrates an in-memory database and accepts one row per table", () => {
    const db = createDb(":memory:");

    const tables = db
      .all<{ name: string }>(sql`select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '__drizzle%'`)
      .map((r) => r.name)
      .sort();
    expect(tables).toEqual(
      [
        "company",
        "competitors",
        "research_questions",
        "sources",
        "snapshots",
        "runs",
        "facts",
        "timeline_events",
        "hypotheses",
        "hypothesis_updates",
        "strategy_profiles",
        "insights",
        "open_questions",
      ].sort(),
    );

    db.insert(s.company).values({ name: "Loop" }).run();
    const [comp] = db.insert(s.competitors).values({ name: "Buffer", slug: "buffer" }).returning().all();
    db.insert(s.researchQuestions).values({ competitorId: comp.id, text: "Are they investing in agencies?" }).run();
    const [src] = db
      .insert(s.sources)
      .values({ competitorId: comp.id, url: "https://buffer.com/pricing", sourceType: "pricing", provider: "seeded" })
      .returning()
      .all();
    const [snap] = db
      .insert(s.snapshots)
      .values({
        sourceId: src.id,
        competitorId: comp.id,
        url: src.url,
        sourceType: "pricing",
        publishedAt: "2023-06-01",
        fetchedAt: "2026-10-31T00:00:00Z",
        extractedText: "Agency plan $100/mo",
        contentHash: "abc",
      })
      .returning()
      .all();
    const [run] = db.insert(s.runs).values({ competitorId: comp.id, label: "Run 1", cutoffDate: "2023-12-31" }).returning().all();
    const [fact] = db
      .insert(s.facts)
      .values({
        runId: run.id,
        competitorId: comp.id,
        snapshotId: snap.id,
        statement: "Buffer sells an Agency plan at $100/mo",
        quote: "Agency plan $100/mo",
        category: "pricing",
        importance: 4,
      })
      .returning()
      .all();
    db.insert(s.timelineEvents)
      .values({ competitorId: comp.id, runId: run.id, eventDate: "2023-06-01", title: "Agency plan", summary: "s", factIds: [fact.id] })
      .run();
    const [hyp] = db
      .insert(s.hypotheses)
      .values({
        competitorId: comp.id,
        dimension: "customers",
        statement: "Buffer is investing in agencies",
        confidence: 0.6,
        createdRunId: run.id,
        updatedRunId: run.id,
      })
      .returning()
      .all();
    db.insert(s.hypothesisUpdates)
      .values({ hypothesisId: hyp.id, runId: run.id, change: "created", newConfidence: 0.6, reasoning: "r", factIds: [fact.id] })
      .run();
    db.insert(s.strategyProfiles)
      .values({
        competitorId: comp.id,
        runId: run.id,
        profile: {
          customers: { summary: "SMB + agencies", confidence: 0.5, factIds: [fact.id] },
          productDirection: { summary: "", confidence: 0.3, factIds: [] },
          positioning: { summary: "", confidence: 0.3, factIds: [] },
          distribution: { summary: "", confidence: 0.3, factIds: [] },
          businessModel: { summary: "", confidence: 0.3, factIds: [] },
        },
      })
      .run();
    db.insert(s.insights)
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
        actions: [{ type: "investigate", text: "x", rationale: "y" }],
      })
      .run();
    db.insert(s.openQuestions).values({ competitorId: comp.id, createdRunId: run.id, question: "q" }).run();

    const storedRun = db.select().from(s.runs).get();
    expect(storedRun?.log).toEqual([]);
    expect(storedRun?.status).toBe("queued");
    const storedInsight = db.select().from(s.insights).get();
    expect(storedInsight?.actions[0].type).toBe("investigate");
    const storedFact = db.select().from(s.facts).get();
    expect(storedFact?.isChange).toBe(false);
  });
});
