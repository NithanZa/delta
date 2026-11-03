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
        "feeds",
        "absence_checks",
        "settings",
        "jobs",
        "digests",
        "digest_items",
        "reactions",
        "events",
        "inbound_messages",
        "snapshots",
        "runs",
        "facts",
        "timeline_events",
        "hypotheses",
        "hypothesis_updates",
        "strategy_profiles",
        "insights",
        "open_questions",
        "usage_events",
      ].sort(),
    );

    db.insert(s.company).values({ name: "Loop", website: "https://loop.example", onboarding: { draftedAt: "2026-11-03T00:00:00.000Z", sourceUrls: ["https://loop.example"], questions: [] } }).run();
    expect(db.select().from(s.company).get()?.onboarding?.sourceUrls).toEqual(["https://loop.example"]);
    const [comp] = db.insert(s.competitors).values({ name: "Buffer", slug: "buffer" }).returning().all();
    expect(comp.profile).toBeNull();
    expect(comp.emphasis).toBe("");
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
    expect(storedRun?.kind).toBe("manual");
    db.insert(s.settings).values({ key: "schedule.runCron", value: "0 5 * * MON" }).run();
    expect(db.select().from(s.settings).get()?.value).toBe("0 5 * * MON");
    db.insert(s.jobs).values({ kind: "run", competitorId: comp.id, requestedBy: "ui" }).run();
    const [digest] = db
      .insert(s.digests)
      .values({ sequence: 1, periodStart: "2026-11-01T00:00:00.000Z", periodEnd: "2026-11-08T00:00:00.000Z", subject: "Delta weekly", html: "<p>x</p>", text: "x", content: { quiet: false } })
      .returning()
      .all();
    const [insight] = db.select().from(s.insights).all();
    db.insert(s.digestItems).values({ digestId: digest.id, competitorId: comp.id, insightId: insight.id, rank: 1 }).run();
    db.insert(s.reactions).values({ insightId: insight.id, digestId: digest.id, kind: "useful", source: "email" }).run();
    expect(() => db.insert(s.reactions).values({ insightId: insight.id, digestId: digest.id, kind: "useful", source: "email" }).run()).toThrow();
    db.insert(s.events).values({ name: "digest_sent", props: { digestId: digest.id } }).run();
    db.insert(s.inboundMessages).values({ providerEmailId: "em_1", fromEmail: "pm@partner.com", toEmail: "delta+d1@delta.example.com", receivedAt: "2026-11-08T09:00:00.000Z" }).run();
    expect(db.select().from(s.digests).get()?.status).toBe("draft");
    expect(db.select().from(s.inboundMessages).get()?.status).toBe("received");
    const storedJob = db.select().from(s.jobs).get();
    expect(storedJob?.status).toBe("queued");
    expect(storedJob?.payload).toEqual({});
    const storedInsight = db.select().from(s.insights).get();
    expect(storedInsight?.actions[0].type).toBe("investigate");
    expect(storedInsight?.score).toBeNull();
    expect(storedInsight?.supersedesInsightId).toBeNull();
    db.insert(s.feeds).values({ competitorId: comp.id, url: "https://buffer.com/resources/feed", kind: "rss" }).run();
    const storedFeed = db.select().from(s.feeds).get();
    expect(storedFeed?.enabled).toBe(true);
    const storedSource = db.select().from(s.sources).get();
    expect(storedSource?.watch).toBe(false);
    expect(storedSource?.discoveryQuery).toBeNull();
    db.insert(s.absenceChecks).values({ competitorId: comp.id, topic: "partner_program", result: "not_found", queries: ["q"], urlsChecked: ["https://buffer.com/partners"] }).run();
    expect(db.select().from(s.absenceChecks).get()?.result).toBe("not_found");
    expect(storedSource?.checkIntervalHours).toBe(168);
    const storedFact = db.select().from(s.facts).get();
    expect(storedFact?.isChange).toBe(false);
    expect(storedFact?.claimKind).toBe("observed");
    expect(storedFact?.billingCadence).toBeNull();
    expect(storedFact?.availability).toBeNull();
    expect(storedFact?.attribution).toBe("public");
    expect(db.select().from(s.hypotheses).get()?.claimKind).toBe("positive");
    const storedQuestion = db.select().from(s.openQuestions).get();
    expect(storedQuestion?.kind).toBe("investigation");
    expect(storedQuestion?.factIds).toEqual([]);
  });
});
