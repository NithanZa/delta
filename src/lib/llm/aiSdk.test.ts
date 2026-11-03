import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiSdkClient } from "./aiSdk";
import { callJson, LlmError, type LlmRequest } from "./client";
import { loadLlmConfig } from "./config";
import { estimateCostUsd } from "./pricing";

type Generate = NonNullable<ConstructorParameters<typeof MockLanguageModelV4>[0]>["doGenerate"];

const usage = (over: Partial<{ total: number; cacheRead: number; cacheWrite: number; out: number }> = {}) => ({
  inputTokens: { total: over.total ?? 100, noCache: (over.total ?? 100) - (over.cacheRead ?? 0) - (over.cacheWrite ?? 0), cacheRead: over.cacheRead ?? 0, cacheWrite: over.cacheWrite ?? 0 },
  outputTokens: { total: over.out ?? 20, text: over.out ?? 20, reasoning: 0 },
});

function textResult(text: string, finish: "stop" | "length" | "content-filter" = "stop", u = usage()) {
  const raw = finish === "stop" ? "end_turn" : finish === "length" ? "max_tokens" : "refusal";
  return { content: [{ type: "text" as const, text }], finishReason: { unified: finish, raw }, usage: u, warnings: [] };
}

const anthropicConfig = loadLlmConfig({ ANTHROPIC_API_KEY: "test", LLM_EXTRACT: "anthropic:claude-haiku-5-5", LLM_SYNTH: "anthropic:claude-opus-5-5" });
const stepfunConfig = loadLlmConfig({ OPENAI_COMPAT_API_KEY: "test" });

const wire = z.object({ facts: z.array(z.object({ statement: z.string() })) });
const lenient = z.object({ facts: z.array(z.object({ statement: z.string() })).catch([]) });

function clientWith(doGenerate: Generate, config = anthropicConfig) {
  const model = new MockLanguageModelV4({ provider: config.roles.extract.provider, modelId: config.roles.extract.model, doGenerate });
  return { model, client: new AiSdkClient({ config, models: { extract: model, synthesize: model } }) };
}

const req: LlmRequest = { task: "extract_facts", role: "extract", system: "SYSTEM PROMPT", user: "USER PROMPT", wire };

describe("AiSdkClient (OpenAI's API, real adapter)", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function requestBody(baseUrl: string) {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      const answer = { id: "c", created: 1, model: "m", choices: [{ index: 0, message: { role: "assistant", content: '{"ok":true}' }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
      return new Response(JSON.stringify(answer), { headers: { "content-type": "application/json" } });
    });
    const config = loadLlmConfig({ OPENAI_COMPAT_API_KEY: "test", OPENAI_COMPAT_BASE_URL: baseUrl, LLM_EXTRACT: "openai:gpt-6-luna" });
    await new AiSdkClient({ config }).complete({ ...req, maxTokens: 500 });
    return bodies[0];
  }

  it("sends max_completion_tokens and no temperature, which GPT-6 models require", async () => {
    const body = await requestBody("https://api.openai.com/v1");
    expect(body).toMatchObject({ model: "gpt-6-luna", max_completion_tokens: 500, reasoning_effort: "low", response_format: { type: "json_object" } });
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("temperature");
  });

  it("leaves other compatible endpoints on max_tokens and a low temperature", async () => {
    const body = await requestBody("https://openrouter.ai/api/v1");
    expect(body).toMatchObject({ max_tokens: 500, temperature: 0.2 });
    expect(body).not.toHaveProperty("max_completion_tokens");
  });
});

describe("AiSdkClient (Anthropic)", () => {
  it("returns the JSON text, maps usage including cache reads, and sends effort + a cached system block", async () => {
    const { model, client } = clientWith(textResult('{"facts":[{"statement":"a"}]}', "stop", usage({ total: 1000, cacheRead: 600, cacheWrite: 100, out: 50 })));
    const res = await client.complete(req);
    expect(res.content).toBe('{"facts":[{"statement":"a"}]}');
    expect(res.truncated).toBe(false);
    expect(res.usage).toEqual({ promptTokens: 1000, completionTokens: 50, cacheReadTokens: 600, cacheWriteTokens: 100 });

    const call = model.doGenerateCalls[0];
    expect(call.providerOptions).toEqual({ anthropic: { effort: "low" } });
    expect(call.maxOutputTokens).toBe(8192);
    expect(call.temperature).toBeUndefined();
    expect(call.responseFormat?.type).toBe("json");
    const system = call.prompt.find((m) => m.role === "system");
    expect(system).toMatchObject({ content: "SYSTEM PROMPT", providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } });
    expect(call.prompt.find((m) => m.role === "user")).toMatchObject({ content: [{ type: "text", text: "USER PROMPT" }] });
  });

  it("flags max_tokens truncation so callJson doubles the budget", async () => {
    const { client } = clientWith(textResult('{"facts":[{"statement":"a', "length"));
    const res = await client.complete(req);
    expect(res.truncated).toBe(true);
    expect(res.content).toContain('{"facts"');
  });

  it("throws an LlmError on a refusal", async () => {
    const { client } = clientWith(textResult("", "content-filter"));
    await expect(client.complete(req)).rejects.toThrow(/refusal/);
    await expect(client.complete(req)).rejects.toBeInstanceOf(LlmError);
  });

  it("hands unparsable output back as text so the retry path applies", async () => {
    const { client } = clientWith(textResult("I cannot produce JSON here."));
    const res = await client.complete(req);
    expect(res.content).toBe("I cannot produce JSON here.");
  });

  it("works end to end through callJson with the lenient schema", async () => {
    const { client } = clientWith(textResult('{"facts":[{"statement":"ok"}]}'));
    const out = await callJson({ ...req, schema: lenient, client });
    expect(out.data.facts[0].statement).toBe("ok");
    expect(out.attempts).toBe(1);
  });

  it("uses the role's effort unless the request overrides it", async () => {
    const { model, client } = clientWith(textResult("{}"));
    await client.complete({ ...req, role: "synthesize", effort: "medium" });
    expect(model.doGenerateCalls[0].providerOptions).toEqual({ anthropic: { effort: "medium" } });
    expect(model.doGenerateCalls[0].maxOutputTokens).toBe(16_000);
  });
});

describe("AiSdkClient (OpenAI-compatible)", () => {
  it("uses JSON mode, temperature and reasoning_effort only for models that support it", async () => {
    const { model, client } = clientWith(textResult('{"facts":[]}'), stepfunConfig);
    await client.complete(req); // step-3.7-flash supports reasoning effort
    await client.complete({ ...req, role: "synthesize" }); // step-5-preview does not
    const [a, b] = model.doGenerateCalls;
    expect(a.providerOptions).toEqual({ openaiCompat: { reasoningEffort: "low" } });
    expect(a.temperature).toBe(0.2);
    expect(a.responseFormat).toMatchObject({ type: "json" });
    expect(a.responseFormat && "schema" in a.responseFormat ? a.responseFormat.schema : undefined).toBeUndefined();
    expect(a.prompt.find((m) => m.role === "system")).toMatchObject({ content: "SYSTEM PROMPT" });
    expect(b.providerOptions).toBeUndefined();
  });
});

describe("pricing", () => {
  it("charges uncached input, cache reads, cache writes and output at list prices", () => {
    const usd = estimateCostUsd("claude-opus-5-5", { promptTokens: 1_000_000, completionTokens: 100_000, cacheReadTokens: 500_000, cacheWriteTokens: 100_000 });
    // 400k uncached × $4 + 500k reads × $0.20 + 100k writes × $5 + 100k out × $20, per million
    expect(usd).toBeCloseTo(1.6 + 0.1 + 0.5 + 2, 6);
    expect(estimateCostUsd("step-5-preview", { promptTokens: 10, completionTokens: 10 })).toBeNull();
  });
});
