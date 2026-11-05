import { describe, expect, it } from "vitest";
import { createDb, schema } from "@/db";
import { hashContent, insertSnapshotRecord } from "@/lib/ingest/snapshot";
import { openWrongReactions, react, reviewWrongReaction } from "./reactions";

function setup() {
  const db = createDb(":memory:");
  const comp = db.insert(schema.competitors).values({ name: "Buffer", slug: "buffer", website: "https://buffer.com", domain: "buffer.com" }).returning().get();
  const run = db.insert(schema.runs).values({ competitorId: comp.id, label: "Run 1", cutoffDate: "2026-01-01" }).returning().get();
  const text = "The Agency plan starts at $120 per month.";
  const { snapshot } = insertSnapshotRecord(db, comp.id, { url: "https://buffer.com/pricing", sourceType: "pricing", provider: "seeded", title: "Pricing", publishedAt: "2025-12-01", fetchedAt: "2025-12-01T00:00:00.000Z", archiveUrl: null, rawHtml: "", extractedText: text, contentHash: hashContent(text) });
  const fact = db.insert(schema.facts).values({ runId: run.id, competitorId: comp.id, snapshotId: snapshot.id, statement: "Agency costs $120", quote: text, category: "pricing" }).returning().get();
  const insight = db.insert(schema.insights).values({ competitorId: comp.id, runId: run.id, title: "Buffer raised agency prices", whatHappened: "Agency is now $120", whatItMeans: "m", whyItMatters: "w", whatToDoNext: "n", severity: "high", factIds: [fact.id] }).returning().get();
  return { db, insight, fact };
}

describe("the Wrong review queue", () => {
  it("lists Wrong reactions with the reader's note and the evidence to check, and nothing else", () => {
    const { db, insight, fact } = setup();
    react(db, { insightId: insight.id, digestId: null, kind: "useful", source: "dashboard" });
    react(db, { insightId: insight.id, digestId: null, kind: "wrong", source: "email", note: "That is the annual price" });
    const queue = openWrongReactions(db);
    expect(queue).toHaveLength(1);
    expect(queue[0].reaction.note).toBe("That is the annual price");
    expect(queue[0].insight.title).toBe("Buffer raised agency prices");
    expect(queue[0].competitor.slug).toBe("buffer");
    expect(queue[0].evidence).toEqual([{ factId: fact.id, quote: fact.quote, statement: fact.statement, url: "https://buffer.com/pricing", title: "Pricing" }]);
  });

  it("drops a reaction from the queue once reviewed and keeps the finding", () => {
    const { db, insight } = setup();
    const { reaction } = react(db, { insightId: insight.id, digestId: null, kind: "wrong", source: "email" });
    expect(reviewWrongReaction(db, reaction.id, "delta_wrong", "Annual, not monthly", new Date("2026-11-04T00:00:00.000Z"))).toBe(true);
    expect(openWrongReactions(db)).toEqual([]);
    expect(db.select().from(schema.reactions).get()).toMatchObject({ reviewOutcome: "delta_wrong", reviewNote: "Annual, not monthly", reviewedAt: "2026-11-04T00:00:00.000Z" });
  });

  it("refuses to review anything but a Wrong reaction", () => {
    const { db, insight } = setup();
    const { reaction } = react(db, { insightId: insight.id, digestId: null, kind: "useful", source: "email" });
    expect(reviewWrongReaction(db, reaction.id, "delta_right")).toBe(false);
    expect(reviewWrongReaction(db, 999, "delta_right")).toBe(false);
  });

  it("reopens a reviewed reaction when the reader adds new context, but not on a repeat click", () => {
    const { db, insight } = setup();
    const args = { insightId: insight.id, digestId: null, kind: "wrong" as const, source: "email" as const };
    const { reaction } = react(db, args);
    reviewWrongReaction(db, reaction.id, "delta_right");
    react(db, args);
    expect(openWrongReactions(db)).toEqual([]);
    react(db, { ...args, note: "Here is the invoice" });
    expect(openWrongReactions(db)).toHaveLength(1);
    expect(db.select().from(schema.reactions).get()).toMatchObject({ reviewOutcome: null, reviewedAt: null });
  });
});
