import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema } from "@/db";
import { hashContent, insertSnapshotRecord } from "@/lib/ingest/snapshot";
import { MockLlmClient } from "@/lib/stepfun/mock";
import { nextReplayRun, REPLAY_RUNS } from "./presets";
import { executeRun, startRun } from "./run";

const page = (plan: string, price: number) =>
  `Buffer pricing. The ${plan} plan starts at $${price} per month for up to 10 channels. Any additional channels cost extra each month. The Team plan includes unlimited users and approval workflows for every channel.`;

function setup() {
  const db = createDb(":memory:");
  db.insert(schema.company).values({ name: "Loop", product: "Scheduling for agencies", priorities: "Win agencies" }).run();
  const comp = db.insert(schema.competitors).values({ name: "Buffer", slug: "buffer" }).returning().get();
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
  add(page("Team", 10), "2025-12-15");
  return { db, comp };
}

async function runNext(db: ReturnType<typeof createDb>, competitorId: number, client: MockLlmClient) {
  const run = startRun(db, { competitorId, ...nextReplayRun(db, competitorId) });
  return executeRun(db, run.id, () => {}, client);
}

describe("executeRun", () => {
  it("replays Run 1 → 2 → 3 with created → strengthened → revised", async () => {
    const { db, comp } = setup();
    const client = new MockLlmClient();

    const r1 = await runNext(db, comp.id, client);
    expect(r1.status).toBe("done");
    expect(r1.label).toBe("Run 1");
    expect(r1.stats.snapshots).toBe(1);
    expect(r1.stats.insights).toBe(1);
    const h1 = db.select().from(schema.hypotheses).all();
    expect(h1).toHaveLength(1);
    expect(h1[0].status).toBe("active");
    expect(db.select().from(schema.strategyProfiles).all()).toHaveLength(1);
    expect(db.select().from(schema.timelineEvents).all()).toHaveLength(1);
    expect(db.select().from(schema.openQuestions).all()).toHaveLength(1);
    const stages = r1.log.map((l) => l.message.match(/^\[(\w+)\]/)?.[1]);
    for (const s of ["select", "extract", "synthesis", "insights", "finalize"]) expect(stages).toContain(s);
    expect(stages.indexOf("extract")).toBeLessThan(stages.indexOf("synthesis"));
    expect(stages.indexOf("synthesis")).toBeLessThan(stages.indexOf("insights"));

    const r2 = await runNext(db, comp.id, client);
    expect(r2.label).toBe("Run 2");
    expect(r2.stats.changes).toBe(1);
    const h2 = db.select().from(schema.hypotheses).where(eq(schema.hypotheses.id, h1[0].id)).get()!;
    expect(h2.status).toBe("strengthened");
    expect(h2.confidence).toBe(0.7);
    // Run 2 resolved the question Run 1 raised and raised a new one.
    expect(db.select().from(schema.openQuestions).all().filter((q) => q.status === "resolved")).toHaveLength(1);

    const r3 = await runNext(db, comp.id, client);
    expect(r3.label).toBe("Run 3");
    const all = db.select().from(schema.hypotheses).all();
    expect(all).toHaveLength(2);
    const old = all.find((h) => h.id === h1[0].id)!;
    const revised = all.find((h) => h.supersedesId === h1[0].id)!;
    expect(old.status).toBe("retired");
    expect(revised.status).toBe("revised");
    expect(revised.statement).toContain("dropped the dedicated agency tier");
    const history = db.select().from(schema.hypothesisUpdates).where(eq(schema.hypothesisUpdates.hypothesisId, h1[0].id)).all().map((u) => u.change);
    expect(history).toEqual(["created", "strengthened", "retired"]);

    // Every update, insight and event cites at least one real fact with a verbatim quote.
    const factIds = new Set(db.select().from(schema.facts).all().map((f) => f.id));
    for (const u of db.select().from(schema.hypothesisUpdates).all()) {
      expect(u.factIds.length).toBeGreaterThan(0);
      for (const id of u.factIds) expect(factIds.has(id)).toBe(true);
    }
    for (const i of db.select().from(schema.insights).all()) expect(i.factIds.every((id) => factIds.has(id))).toBe(true);

    // After the presets, the next run is "Run 4" dated today.
    expect(nextReplayRun(db, comp.id).label).toBe("Run 4");
    expect(REPLAY_RUNS).toHaveLength(3);
  });

  it("requires the model to honor a pending user correction and marks it applied", async () => {
    const { db, comp } = setup();
    const client = new MockLlmClient();
    await runNext(db, comp.id, client);
    const h = db.select().from(schema.hypotheses).get()!;
    db.update(schema.hypotheses).set({ userCorrection: "We know this is only true for agencies with 10+ clients.", correctionAppliedRunId: null }).where(eq(schema.hypotheses.id, h.id)).run();

    await runNext(db, comp.id, client);
    const synthCall = client.calls.filter((c) => c.task === "synthesize").at(-1)!;
    expect(synthCall.user).toContain("NEW USER CORRECTION");
    expect(synthCall.user).toContain("10+ clients");
    const after = db.select().from(schema.hypotheses).where(eq(schema.hypotheses.id, h.id)).get()!;
    expect(after.correctionAppliedRunId).not.toBeNull();

    // Once applied, the prompt no longer demands an update for it.
    await runNext(db, comp.id, client);
    const nextCall = client.calls.filter((c) => c.task === "synthesize").at(-1)!;
    expect(nextCall.user).toContain("already reflected");
    expect(nextCall.user).not.toContain("NEW USER CORRECTION");
  });

  it("marks the run failed when a stage throws but keeps earlier output", async () => {
    const { db, comp } = setup();
    const client = new MockLlmClient().on("generate_insights", () => {
      throw new Error("insight model down");
    });
    const r = await runNext(db, comp.id, client);
    expect(r.status).toBe("failed");
    expect(r.error).toContain("insight model down");
    expect(db.select().from(schema.hypotheses).all()).toHaveLength(1);
    expect(db.select().from(schema.insights).all()).toHaveLength(0);
    expect(r.log.at(-1)?.message).toMatch(/\[error\] insights failed/);
    // A failed run does not advance the replay.
    expect(nextReplayRun(db, comp.id).label).toBe("Run 1");
  });

  it("drops references to ids the model was not given", async () => {
    const { db, comp } = setup();
    const client = new MockLlmClient().on("synthesize", () => ({
      timelineEvents: [{ eventDate: "2023-06-17", title: "Agency plan listed", summary: "Agency plan at $120.", factIds: [999, "F1"], relatedEventIds: [42] }],
      hypothesisUpdates: [{ hypothesisId: 77, dimension: "customers", statement: "x".repeat(20), change: "strengthened", confidence: 0.5, reasoning: "mock reasoning here", factIds: [] }],
      strategyProfile: {
        customers: { summary: "s", confidence: 0.4, factIds: [1, 5000] },
        productDirection: { summary: "s", confidence: 0.4, factIds: [] },
        positioning: { summary: "s", confidence: 0.4, factIds: [] },
        distribution: { summary: "s", confidence: 0.4, factIds: [] },
        businessModel: { summary: "s", confidence: 0.4, factIds: [] },
      },
      openQuestions: { resolved: [{ id: 123, resolution: "nope" }], new: [] },
    }));
    const r = await runNext(db, comp.id, client);
    expect(r.status).toBe("done");
    expect(db.select().from(schema.hypotheses).all()).toHaveLength(0);
    const ev = db.select().from(schema.timelineEvents).get()!;
    expect(ev.factIds).toEqual([1]);
    expect(ev.relatedEventIds).toEqual([]);
    expect(db.select().from(schema.strategyProfiles).get()!.profile.customers.factIds).toEqual([1]);
    expect(r.log.filter((l) => l.level === "warn").length).toBeGreaterThanOrEqual(3);
  });
});
