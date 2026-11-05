import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, getDb, schema } from "@/db";
import { exaContents, exaSearch } from "@/lib/ingest/exa";
import { AiSdkClient } from "@/lib/llm/aiSdk";
import { hashContent, insertSnapshotRecord } from "@/lib/ingest/snapshot";
import { loadLlmConfig } from "@/lib/llm/config";
import { MockLlmClient } from "@/lib/llm/mock";
import { executeRun, startRun } from "@/lib/pipeline/run";
import { recordUsage, usageReport, withUsageScope } from "./usage";

const now = new Date("2026-11-10T12:00:00.000Z");

function pipelineSetup() {
  const db = createDb(":memory:");
  db.insert(schema.company).values({ name: "Loop" }).run();
  const comp = db.insert(schema.competitors).values({ name: "Buffer", slug: "buffer", website: "https://buffer.com", domain: "buffer.com" }).returning().get();
  for (const n of [1, 2, 3]) {
    const text = `Buffer pricing page ${n}. The Agency plan starts at $120 per month for up to 10 channels. Any additional channels cost extra each month. The Team plan includes unlimited users.`;
    insertSnapshotRecord(db, comp.id, { url: `https://buffer.com/pricing/${n}`, sourceType: "pricing", provider: "seeded", title: "Pricing", publishedAt: "2023-06-17", fetchedAt: "2026-10-31T00:00:00.000Z", archiveUrl: null, rawHtml: "", extractedText: text, contentHash: hashContent(text) });
  }
  return { db, comp };
}
const llm = { service: "llm" as const, provider: "openai.com", model: "gpt-6-luna", task: "extract_facts" };
const exa = { service: "exa" as const, provider: "exa.ai", model: "search", task: "discovery" };

function seed() {
  const db = createDb(":memory:");
  const at = (iso: string, entry: Parameters<typeof recordUsage>[0]) => {
    recordUsage(entry, db);
    const last = db.select().from(schema.usageEvents).all().at(-1)!;
    db.update(schema.usageEvents).set({ createdAt: iso }).where(eq(schema.usageEvents.id, last.id)).run();
  };
  at("2026-11-10T09:00:00.000Z", { ...llm, costUsd: 0.5, promptTokens: 1000, completionTokens: 100 });
  at("2026-11-10T09:30:00.000Z", { ...exa, costUsd: 0.01 });
  at("2026-11-06T09:00:00.000Z", { ...llm, costUsd: 0.25 });
  at("2026-10-20T09:00:00.000Z", { ...llm, model: "step-5-preview", provider: "stepfun.ai", costUsd: null, promptTokens: 7 });
  at("2026-01-01T09:00:00.000Z", { ...exa, costUsd: 2 });
  return db;
}

describe("usageReport", () => {
  it("adds up each period, split by service, and counts calls with no known price", () => {
    const { periods } = usageReport(seed(), now);
    const by = Object.fromEntries(periods.map((p) => [p.label, p]));
    expect(by["Today (UTC)"].total.usd).toBeCloseTo(0.51);
    expect(by["Today (UTC)"].llm.usd).toBeCloseTo(0.5);
    expect(by["Today (UTC)"].exa.usd).toBeCloseTo(0.01);
    expect(by["Last 7 days"].total.usd).toBeCloseTo(0.76);
    expect(by["Last 30 days"].total).toMatchObject({ calls: 4, unpriced: 1 });
    expect(by["All time"].total.usd).toBeCloseTo(2.76);
  });

  it("groups by day, model and task, most expensive first", () => {
    const report = usageReport(seed(), now);
    expect(report.days[0]).toMatchObject({ day: "2026-11-10", calls: 2 });
    expect(report.days[0].llmUsd).toBeCloseTo(0.5);
    expect(report.days[0].exaUsd).toBeCloseTo(0.01);
    expect(report.byModel[0]).toMatchObject({ provider: "openai.com", model: "gpt-6-luna", calls: 2 });
    expect(report.byTask[0]).toMatchObject({ task: "extract_facts", calls: 3 });
    expect(report.firstAt).toBe("2026-01-01T09:00:00.000Z");
  });

  it("is empty rather than broken with no rows", () => {
    const report = usageReport(createDb(":memory:"), now);
    expect(report.firstAt).toBeNull();
    expect(report.periods[3].total).toMatchObject({ usd: 0, calls: 0 });
  });
});

describe("spend per competitor and per digest", () => {
  it("adds up each competitor's week by stage and keeps unscoped calls as Shared", () => {
    const db = createDb(":memory:");
    const buffer = db.insert(schema.competitors).values({ name: "Buffer", slug: "buffer", website: "https://buffer.com", domain: "buffer.com" }).returning().get();
    const record = (task: string, costUsd: number | null) => recordUsage({ service: "llm", provider: "openai.com", model: "m", task, costUsd }, db);
    withUsageScope({ competitorId: buffer.id }, () => {
      record("extract_facts", 0.1);
      record("synthesize", 1);
      record("generate_insights", 0.5);
      record("assess_relevance", 0.01);
      record("write_digest", null);
    });
    record("draft_company", 0.2);
    const weeks = usageReport(db).competitorWeeks;
    expect(weeks.map((w) => w.name)).toEqual(["Buffer", "Shared"]);
    expect(weeks[0].stages.extraction).toBeCloseTo(0.1);
    expect(weeks[0].stages.synthesis).toBeCloseTo(1.5);
    expect(weeks[0].stages.discovery).toBeCloseTo(0.01);
    expect(weeks[0].usd).toBeCloseTo(1.61);
    expect(weeks[0].unpriced).toBe(1);
    expect(weeks[1].stages.other).toBeCloseTo(0.2);
  });

  it("charges a whole run to its competitor and run, including its parallel extraction calls", async () => {
    const { db, comp } = pipelineSetup();
    const recording = new MockLlmClient();
    const inner = recording.complete.bind(recording);
    recording.complete = async (req) => {
      const res = await inner(req);
      await new Promise((r) => setTimeout(r, 1)); // like a real network call, so concurrent calls interleave
      recordUsage({ service: "llm", provider: "mock", model: "mock", task: req.task, costUsd: 0.01 }, db);
      return res;
    };
    const run = startRun(db, { competitorId: comp.id, label: "Run 1", cutoffDate: "2030-01-01" });
    const done = await executeRun(db, run.id, () => {}, recording);
    expect(done.status).toBe("done");
    const rows = db.select().from(schema.usageEvents).all();
    expect(rows.length).toBeGreaterThan(3);
    expect(rows.every((r) => r.competitorId === comp.id && r.runId === run.id)).toBe(true);
  });

  it("gives each sent digest the spend inside its period, and nothing for unsent ones", () => {
    const { db } = pipelineSetup();
    const at = (iso: string, costUsd: number) => {
      recordUsage({ service: "llm", provider: "m", model: "m", task: "synthesize", costUsd }, db);
      const last = db.select().from(schema.usageEvents).all().at(-1)!;
      db.update(schema.usageEvents).set({ createdAt: iso }).where(eq(schema.usageEvents.id, last.id)).run();
    };
    at("2026-11-03T00:00:00.000Z", 1);
    at("2026-11-05T00:00:00.000Z", 2);
    at("2026-11-12T00:00:00.000Z", 4);
    const digest = (sequence: number, periodStart: string, periodEnd: string, status: "sent" | "held") => db.insert(schema.digests).values({ sequence, periodStart, periodEnd, status, subject: "", html: "", text: "", content: {} }).run();
    digest(1, "2026-11-01T00:00:00.000Z", "2026-11-04T00:00:00.000Z", "sent");
    digest(2, "2026-11-04T00:00:00.000Z", "2026-11-11T00:00:00.000Z", "sent");
    digest(3, "2026-11-11T00:00:00.000Z", "2026-11-18T00:00:00.000Z", "held");
    const spends = usageReport(db).digests;
    expect(spends.map((d) => [d.sequence, d.usd])).toEqual([
      [2, 2],
      [1, 1],
    ]);
  });
});

describe("recording at the source", () => {
  const rows = () => getDb().select().from(schema.usageEvents).all();

  it("records a model call with its billing host, list-price cost and task", async () => {
    const before = rows().length;
    const config = loadLlmConfig({ OPENAI_COMPAT_API_KEY: "k", OPENAI_COMPAT_BASE_URL: "https://api.openai.com/v1" });
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: "text", text: "{}" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 1_000_000, noCache: 1_000_000, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 100_000, text: 100_000, reasoning: 0 } },
        warnings: [],
      },
    });
    await new AiSdkClient({ config, models: { extract: model } }).complete({ task: "assess_relevance", role: "extract", system: "s", user: "u" });
    const added = rows().slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ service: "llm", provider: "openai.com", model: "gpt-6-luna", task: "assess_relevance", promptTokens: 1_000_000, completionTokens: 100_000 });
    expect(added[0].costUsd).toBeCloseTo(0.15); // 1M × $0.10 + 0.1M × $0.50
  });

  it("records each successful Exa request at the cost Exa reports, and nothing for a failure", async () => {
    const before = rows().length;
    const respond = (status: number, body: unknown): typeof fetch => async () => new Response(JSON.stringify(body), { status });
    await exaSearch({ query: "x" }, { apiKey: "k", task: "discovery", fetchImpl: respond(200, { results: [], costDollars: { total: 0.007 } }) });
    await exaContents(["https://a.example"], { apiKey: "k", task: "page_fallback", fetchImpl: respond(200, { results: [] }) });
    await exaSearch({ query: "x" }, { apiKey: "k", fetchImpl: respond(400, {}) }).catch(() => {});
    const added = rows().slice(before);
    expect(added.map((r) => [r.provider, r.model, r.task, r.costUsd])).toEqual([
      ["exa.ai", "search", "discovery", 0.007],
      ["exa.ai", "contents", "page_fallback", null],
    ]);
  });
});
