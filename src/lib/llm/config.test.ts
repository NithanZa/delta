import { describe, expect, it } from "vitest";
import { loadLlmConfig, parseModelSpec } from "./config";

describe("parseModelSpec", () => {
  it("splits provider:model and normalises provider aliases", () => {
    expect(parseModelSpec("anthropic:claude-haiku-5-5")).toEqual({ provider: "anthropic", model: "claude-haiku-5-5" });
    expect(parseModelSpec(" OpenAI:step-3.7-flash ")).toEqual({ provider: "openai", model: "step-3.7-flash" });
    expect(parseModelSpec("stepfun:step-5-preview").provider).toBe("openai");
  });

  it("rejects specs without a provider or model", () => {
    expect(() => parseModelSpec("claude-haiku-5-5")).toThrow(/provider:model/);
    expect(() => parseModelSpec("anthropic:")).toThrow(/provider:model/);
    expect(() => parseModelSpec("gemini:pro")).toThrow(/Unknown provider/);
  });
});

describe("loadLlmConfig", () => {
  it("defaults to Claude Haiku 5.5 for extraction and Claude Opus 5.5 for synthesis", () => {
    const cfg = loadLlmConfig({ ANTHROPIC_API_KEY: "k" });
    expect(cfg.roles.extract).toMatchObject({ provider: "anthropic", model: "claude-haiku-5-5", effort: "low", supportsReasoningEffort: false });
    expect(cfg.roles.synthesize).toMatchObject({ provider: "anthropic", model: "claude-opus-5-5", effort: "high" });
    expect(cfg.openaiCompat.baseUrl).toBe("https://api.stepfun.ai/v1");
    expect(cfg.openaiCompat.temperature).toBe(0.2);
  });

  it("falls back to the StepFun models when only an OpenAI-compatible key is present", () => {
    const cfg = loadLlmConfig({ OPENAI_COMPAT_API_KEY: "sk" });
    expect(cfg.roles.extract).toMatchObject({ provider: "openai", model: "step-3.7-flash", supportsReasoningEffort: true });
    expect(cfg.roles.synthesize).toMatchObject({ provider: "openai", model: "step-5-preview", supportsReasoningEffort: false });
  });

  it("uses GPT models and no temperature on OpenAI's API, unless a temperature is asked for", () => {
    const cfg = loadLlmConfig({ OPENAI_COMPAT_API_KEY: "sk", OPENAI_COMPAT_BASE_URL: "https://api.openai.com/v1" });
    expect(cfg.roles.extract).toMatchObject({ provider: "openai", model: "gpt-6-luna", supportsReasoningEffort: true });
    expect(cfg.roles.synthesize).toMatchObject({ provider: "openai", model: "gpt-6.1-sol", supportsReasoningEffort: true });
    expect(cfg.openaiCompat.temperature).toBeUndefined();
    expect(loadLlmConfig({ OPENAI_COMPAT_API_KEY: "sk", OPENAI_COMPAT_BASE_URL: "https://api.openai.com/v1", LLM_OPENAI_TEMPERATURE: "1" }).openaiCompat.temperature).toBe(1);
  });

  it("honours explicit specs, efforts, temperature and the reasoning-effort allow-list", () => {
    const cfg = loadLlmConfig({
      ANTHROPIC_API_KEY: "k",
      OPENAI_COMPAT_API_KEY: "sk",
      OPENAI_COMPAT_BASE_URL: "https://openrouter.ai/api/v1",
      LLM_EXTRACT: "openai:gpt-5-mini",
      LLM_SYNTH: "anthropic:claude-sonnet-5-5",
      LLM_EXTRACT_EFFORT: "Medium",
      LLM_SYNTH_EFFORT: "high",
      LLM_REASONING_EFFORT_MODELS: "gpt-5-mini, o4-mini",
      LLM_OPENAI_TEMPERATURE: "0",
    });
    expect(cfg.roles.extract).toEqual({ provider: "openai", model: "gpt-5-mini", effort: "medium", supportsReasoningEffort: true });
    expect(cfg.roles.synthesize).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5", effort: "high", supportsReasoningEffort: false });
    expect(cfg.openaiCompat).toEqual({ baseUrl: "https://openrouter.ai/api/v1", apiKey: "sk", temperature: 0 });
  });

  it("rejects bad effort and temperature values", () => {
    expect(() => loadLlmConfig({ LLM_EXTRACT_EFFORT: "max" })).toThrow(/LLM_EXTRACT_EFFORT/);
    expect(() => loadLlmConfig({ LLM_OPENAI_TEMPERATURE: "hot" })).toThrow(/LLM_OPENAI_TEMPERATURE/);
    expect(() => loadLlmConfig({ LLM_SYNTH: "nope" })).toThrow(/provider:model/);
  });
});
