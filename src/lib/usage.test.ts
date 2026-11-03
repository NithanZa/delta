import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, getDb, schema } from "@/db";
import { exaContents, exaSearch } from "@/lib/ingest/exa";
import { AiSdkClient } from "@/lib/llm/aiSdk";
import { loadLlmConfig } from "@/lib/llm/config";
import { recordUsage, usageReport } from "./usage";

const now = new Date("2026-11-10T12:00:00.000Z");
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
