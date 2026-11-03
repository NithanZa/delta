import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema } from "@/db";
import { hashContent, insertSnapshotRecord } from "@/lib/ingest/snapshot";
import { MockLlmClient, sectionAfter } from "@/lib/llm/mock";
import { loadCompanyContext } from "./context";
import { filterVerbatim } from "./extract";
import { assertPointInTime, PointInTimeError } from "./guards";
import { nextRun } from "./presets";
import { executeRun, startRun } from "./run";
import { loadResearchState } from "./state";
import { ABSENCE_CAP, runSynthesis } from "./synthesize";

const page = (plan: string, price: number) =>
  `Buffer pricing. The ${plan} plan starts at $${price} per month for up to 10 channels. Any additional channels cost extra each month. The Team plan includes unlimited users and approval workflows for every channel.`;

function setup() {
  const db = createDb(":memory:");
  db.insert(schema.company).values({ name: "Loop", product: "Scheduling for agencies", priorities: "Win agencies" }).run();
  const comp = db.insert(schema.competitors).values({ name: "Buffer", slug: "buffer" }).returning().get();
  db.insert(schema.researchQuestions).values({ competitorId: comp.id, text: "Does Buffer have a partner program?" }).run();
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
    }).snapshot;
  const s1 = add(page("Agency", 120), "2023-06-17");
  const s2 = add(page("Agency", 100), "2024-08-16");
  const s3 = add(page("Team", 10), "2025-12-15");
  return { db, comp, snapshots: [s1, s2, s3] };
}

const newFactIds = (user: string) => Array.from(new Set(Array.from(sectionAfter(user, "## NEW facts extracted").matchAll(/\bF(\d+)\b/g), (m) => Number(m[1]))));
const profile = (factIds: number[]) =>
  Object.fromEntries(["customers", "productDirection", "positioning", "distribution", "businessModel"].map((k) => [k, { summary: `Mock ${k}`, confidence: 0.4, factIds: factIds.slice(0, 1) }]));

async function runNext(db: ReturnType<typeof createDb>, competitorId: number, client: MockLlmClient) {
  const run = startRun(db, { competitorId, ...nextRun(db, competitorId) });
  return executeRun(db, run.id, () => {}, client);
}

describe("absence cap", () => {
  it("caps an absence hypothesis at 0.4 when no absence-check fact is cited, and logs a warning", async () => {
    const { db, comp } = setup();
    const client = new MockLlmClient().on("synthesize", (req) => {
      const factIds = newFactIds(req.user);
      return {
        timelineEvents: [],
        hypothesisUpdates: [
          { hypothesisId: null, dimension: "distribution", statement: "Buffer has no partner or affiliate program.", change: "created", claimKind: "absence", confidence: 0.8, reasoning: "The pricing page does not mention one.", factIds },
        ],
        strategyProfile: profile(factIds),
        conflicts: [],
        openQuestions: { resolved: [], new: [] },
      };
    });
    const r = await runNext(db, comp.id, client);
    expect(r.status).toBe("done");
    const h = db.select().from(schema.hypotheses).get()!;
    expect(h.claimKind).toBe("absence");
    expect(h.confidence).toBe(ABSENCE_CAP);
    const u = db.select().from(schema.hypothesisUpdates).get()!;
    expect(u.newConfidence).toBe(ABSENCE_CAP);
    expect(r.log.some((l) => l.level === "warn" && /absence claim without an absence check/.test(l.message))).toBe(true);
  });

  it("lets an absence hypothesis exceed 0.4 when it cites an absence-check fact", async () => {
    const { db, comp, snapshots } = setup();
    const client = new MockLlmClient();
    const r1 = await runNext(db, comp.id, client); // Run 1 with the default mock
    // An explicit check (phase 8 creates these) recorded as a prior fact.
    const check = db
      .insert(schema.facts)
      .values({
        runId: r1.id,
        competitorId: comp.id,
        snapshotId: snapshots[0].id,
        statement: "No partner or affiliate program page was found on buffer.com (checked /partners, /affiliates, footer).",
        quote: "absence check: /partners, /affiliates, footer",
        category: "distribution",
        eventDate: "2023-06-17",
        importance: 3,
        claimKind: "absence",
      })
      .returning()
      .get();
    client.on("synthesize", (req) => {
      const factIds = newFactIds(req.user);
      return {
        timelineEvents: [],
        hypothesisUpdates: [
          { hypothesisId: null, dimension: "distribution", statement: "Buffer has no partner or affiliate program.", change: "created", claimKind: "absence", confidence: 0.8, reasoning: "An explicit check found nothing.", factIds: [check.id, ...factIds] },
        ],
        strategyProfile: profile(factIds),
        conflicts: [],
        openQuestions: { resolved: [], new: [] },
      };
    });
    const r2 = await runNext(db, comp.id, client);
    expect(r2.status).toBe("done");
    const h = db.select().from(schema.hypotheses).all().find((x) => x.claimKind === "absence")!;
    expect(h.confidence).toBe(0.8);
    expect(r2.log.some((l) => /absence claim without an absence check/.test(l.message))).toBe(false);
  });
});

describe("conflict questions", () => {
  it("stores a conflict as an open question citing both facts, and de-duplicates the same fact set next run", async () => {
    const { db, comp } = setup();
    const client = new MockLlmClient();
    const r1 = await runNext(db, comp.id, client);
    const priorIds = db.select().from(schema.facts).where(eq(schema.facts.runId, r1.id)).all().map((f) => f.id);
    expect(priorIds.length).toBeGreaterThanOrEqual(2);
    const conflict = { question: "Which Agency limit is current: 10 channels (pricing page) or 12 (help center)?", factIds: [priorIds[1], priorIds[0]] };
    client.on("synthesize", (req) => {
      const factIds = newFactIds(req.user);
      return {
        timelineEvents: [],
        hypothesisUpdates: [],
        strategyProfile: profile(factIds),
        conflicts: [conflict, { question: "A conflict with a single fact is dropped", factIds: [priorIds[0]] }],
        openQuestions: { resolved: [], new: [] },
      };
    });
    const r2 = await runNext(db, comp.id, client);
    expect(r2.status).toBe("done");
    const conflicts = db.select().from(schema.openQuestions).all().filter((q) => q.kind === "conflict");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].factIds).toEqual([priorIds[0], priorIds[1]].sort((a, b) => a - b));
    expect(conflicts[0].status).toBe("open");
    expect(r2.log.some((l) => /Dropped a conflict that does not cite two facts/.test(l.message))).toBe(true);

    const r3 = await runNext(db, comp.id, client);
    expect(r3.status).toBe("done");
    expect(db.select().from(schema.openQuestions).all().filter((q) => q.kind === "conflict")).toHaveLength(1);
    expect(r3.log.some((l) => /already open for the same facts/.test(l.message))).toBe(true);
  });
});

describe("point-in-time guard", () => {
  it("assertPointInTime throws when a prior fact rests on a page dated after the cutoff", () => {
    const { db, comp, snapshots } = setup();
    const prior = db.insert(schema.runs).values({ competitorId: comp.id, label: "Prior", cutoffDate: "2026-10-31", status: "done" }).returning().get();
    db.insert(schema.facts)
      .values({ runId: prior.id, competitorId: comp.id, snapshotId: snapshots[2].id, statement: "Team plan at $10.", quote: "The Team plan starts at $10 per month", category: "pricing", importance: 3 })
      .run();
    const run = db.insert(schema.runs).values({ competitorId: comp.id, label: "Backfill", cutoffDate: "2023-12-31", status: "running" }).returning().get();
    const state = loadResearchState(db, comp.id, run.id);
    expect(() => assertPointInTime(run, state, [])).toThrow(PointInTimeError);
    expect(() => assertPointInTime(run, state, [])).toThrow(/dated after the cutoff 2023-12-31/);
  });

  it("runSynthesis refuses before calling the model and the run is marked failed", async () => {
    const { db, comp, snapshots } = setup();
    const client = new MockLlmClient();
    const r1 = await runNext(db, comp.id, client);
    db.insert(schema.facts)
      .values({ runId: r1.id, competitorId: comp.id, snapshotId: snapshots[2].id, statement: "Team plan at $10.", quote: "The Team plan starts at $10 per month", category: "pricing", importance: 3 })
      .run();
    const callsBefore = client.calls.filter((c) => c.task === "synthesize").length;
    const run = db.insert(schema.runs).values({ competitorId: comp.id, label: "Run 2", cutoffDate: "2024-12-31", status: "running" }).returning().get();
    const ctx = loadCompanyContext(db, comp.id);
    const state = loadResearchState(db, comp.id, run.id);
    await expect(runSynthesis(db, run, ctx, state, [], () => {}, client)).rejects.toThrow(PointInTimeError);
    expect(client.calls.filter((c) => c.task === "synthesize").length).toBe(callsBefore);

    const r2 = await runNext(db, comp.id, client);
    expect(r2.status).toBe("failed");
    expect(r2.error).toMatch(/Point-in-time violation/);
  });
});

describe("verbatim exemption", () => {
  it("keeps absence facts without a matching quote and still drops non-verbatim observed facts", () => {
    const text = "Buffer pricing. The Team plan starts at $10 per month.";
    const base = { category: "pricing" as const, eventDate: null, importance: 3, billingCadence: null, availability: null };
    const { kept, dropped } = filterVerbatim(
      [
        { ...base, statement: "Observed, verbatim", quote: "The Team plan starts at $10 per month.", claimKind: "observed" },
        { ...base, statement: "Observed, fabricated", quote: "The Agency plan starts at $500 per month.", claimKind: "observed" },
        { ...base, statement: "No partner page found", quote: "absence check: /partners, /affiliates", claimKind: "absence" },
      ],
      [text],
    );
    expect(kept.map((f) => f.statement)).toEqual(["Observed, verbatim", "No partner page found"]);
    expect(dropped.map((f) => f.statement)).toEqual(["Observed, fabricated"]);
  });
});
