import { env } from "@/lib/env";
import type { LlmEffort, LlmRole } from "./client";

export type LlmProvider = "anthropic" | "openai";
export type ModelSpec = { provider: LlmProvider; model: string };

export type RoleConfig = ModelSpec & {
  effort: LlmEffort;
  /** OpenAI-compatible only: send `reasoning_effort` (StepFun step-3.7-flash accepts it; step-5-preview does not). */
  supportsReasoningEffort: boolean;
};

export type LlmConfig = {
  roles: Record<LlmRole, RoleConfig>;
  anthropicApiKey: string;
  /** `temperature` is left out of the request when undefined. */
  openaiCompat: { baseUrl: string; apiKey: string; temperature?: number };
};

/** Default per role when nothing is configured and an Anthropic key is present. */
export const DEFAULT_MODELS: Record<LlmRole, string> = {
  extract: "anthropic:claude-haiku-5-5",
  synthesize: "anthropic:claude-opus-5-5",
};

/** Used when only an OpenAI-compatible (StepFun) key is configured. */
export const STEPFUN_MODELS: Record<LlmRole, string> = {
  extract: "openai:step-3.7-flash",
  synthesize: "openai:step-5-preview",
};

/** Used when the OpenAI-compatible endpoint is OpenAI's own API and no Anthropic key is set. */
export const OPENAI_MODELS: Record<LlmRole, string> = {
  extract: "openai:gpt-6-luna",
  synthesize: "openai:gpt-6.1-sol",
};

export const DEFAULT_EFFORT: Record<LlmRole, LlmEffort> = { extract: "low", synthesize: "high" };

/** OpenAI-compatible models known to accept `reasoning_effort`. Extend with LLM_REASONING_EFFORT_MODELS. */
export const REASONING_EFFORT_MODELS = ["step-3.7-flash", "gpt-6-luna", "gpt-6.1-sol"];

/** OpenAI's own API differs from other compatible endpoints: see `createLanguageModel` and the temperature default below. */
export function isOpenAiApi(baseUrl: string | undefined): boolean {
  try {
    return new URL(baseUrl ?? "").hostname === "api.openai.com";
  } catch {
    return false;
  }
}

/** Who bills a role's calls. "openai" only means the wire format, so the endpoint's host decides. */
export function billingProvider(role: ModelSpec, baseUrl: string): string {
  if (role.provider === "anthropic") return "anthropic.com";
  try {
    return new URL(baseUrl).hostname.replace(/^api\./, "");
  } catch {
    return role.provider;
  }
}

const PROVIDER_ALIASES: Record<string, LlmProvider> = {
  anthropic: "anthropic",
  claude: "anthropic",
  openai: "openai",
  "openai-compatible": "openai",
  "openai-compat": "openai",
  stepfun: "openai",
};

/** Parse `provider:model` (e.g. `anthropic:claude-haiku-5-5`, `openai:step-3.7-flash`). */
export function parseModelSpec(spec: string): ModelSpec {
  const trimmed = spec.trim();
  const i = trimmed.indexOf(":");
  if (i <= 0 || i === trimmed.length - 1) {
    throw new Error(`Invalid model spec "${spec}": expected provider:model, e.g. anthropic:claude-haiku-5-5 or openai:step-3.7-flash`);
  }
  const providerKey = trimmed.slice(0, i).toLowerCase();
  const provider = PROVIDER_ALIASES[providerKey];
  if (!provider) throw new Error(`Unknown provider "${providerKey}" in model spec "${spec}" (use anthropic or openai)`);
  return { provider, model: trimmed.slice(i + 1).trim() };
}

function parseEffort(value: string | undefined, fallback: LlmEffort, name: string): LlmEffort {
  if (!value) return fallback;
  const v = value.trim().toLowerCase();
  if (v === "low" || v === "medium" || v === "high") return v;
  throw new Error(`${name} must be low, medium or high (got "${value}")`);
}

export type LlmEnv = {
  LLM_EXTRACT?: string;
  LLM_SYNTH?: string;
  LLM_EXTRACT_EFFORT?: string;
  LLM_SYNTH_EFFORT?: string;
  LLM_REASONING_EFFORT_MODELS?: string;
  LLM_OPENAI_TEMPERATURE?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_COMPAT_BASE_URL?: string;
  OPENAI_COMPAT_API_KEY?: string;
};

function envFromProcess(): LlmEnv {
  return {
    LLM_EXTRACT: env.llmExtract,
    LLM_SYNTH: env.llmSynth,
    LLM_EXTRACT_EFFORT: env.llmExtractEffort,
    LLM_SYNTH_EFFORT: env.llmSynthEffort,
    LLM_REASONING_EFFORT_MODELS: env.llmReasoningEffortModels,
    LLM_OPENAI_TEMPERATURE: env.llmOpenaiTemperature,
    ANTHROPIC_API_KEY: env.anthropicApiKey,
    OPENAI_COMPAT_BASE_URL: env.openaiCompatBaseUrl,
    OPENAI_COMPAT_API_KEY: env.openaiCompatApiKey,
  };
}

/**
 * Build the LLM configuration from environment-shaped input. Missing
 * credentials do not throw here (tests and the mock never need them);
 * the provider factory throws when a model is actually created.
 */
export function loadLlmConfig(e: LlmEnv = envFromProcess()): LlmConfig {
  const anthropicApiKey = e.ANTHROPIC_API_KEY ?? "";
  const openaiApiKey = e.OPENAI_COMPAT_API_KEY ?? "";
  // Existing .env.local files only have a StepFun key: keep them working without new variables.
  const openaiApi = isOpenAiApi(e.OPENAI_COMPAT_BASE_URL);
  const fallback = !anthropicApiKey && openaiApiKey ? (openaiApi ? OPENAI_MODELS : STEPFUN_MODELS) : DEFAULT_MODELS;
  const reasoningModels = new Set([
    ...REASONING_EFFORT_MODELS,
    ...(e.LLM_REASONING_EFFORT_MODELS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ]);
  const role = (name: LlmRole, spec: string | undefined, effortRaw: string | undefined, effortName: string): RoleConfig => {
    const parsed = parseModelSpec(spec?.trim() || fallback[name]);
    return {
      ...parsed,
      effort: parseEffort(effortRaw, DEFAULT_EFFORT[name], effortName),
      supportsReasoningEffort: parsed.provider === "openai" && reasoningModels.has(parsed.model),
    };
  };
  // GPT-6 models reject any temperature but the default, so OpenAI's API gets none unless one is asked for.
  const temperature = e.LLM_OPENAI_TEMPERATURE ? Number(e.LLM_OPENAI_TEMPERATURE) : openaiApi ? undefined : 0.2;
  if (temperature !== undefined && (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)) {
    throw new Error(`LLM_OPENAI_TEMPERATURE must be a number between 0 and 2 (got "${e.LLM_OPENAI_TEMPERATURE}")`);
  }
  return {
    roles: {
      extract: role("extract", e.LLM_EXTRACT, e.LLM_EXTRACT_EFFORT, "LLM_EXTRACT_EFFORT"),
      synthesize: role("synthesize", e.LLM_SYNTH, e.LLM_SYNTH_EFFORT, "LLM_SYNTH_EFFORT"),
    },
    anthropicApiKey,
    openaiCompat: {
      baseUrl: e.OPENAI_COMPAT_BASE_URL || "https://api.stepfun.ai/v1",
      apiKey: openaiApiKey,
      temperature,
    },
  };
}

let cached: LlmConfig | undefined;

export function getLlmConfig(): LlmConfig {
  if (!cached) cached = loadLlmConfig();
  return cached;
}

/** Test hook. */
export function resetLlmConfig(config?: LlmConfig) {
  cached = config;
}

export type ModelLabels = Record<LlmRole, string>;

/** Model ids per role for the UI (server-side only; reads env). */
export function getModelLabels(): ModelLabels {
  if (env.mockLlm) return { extract: "mock", synthesize: "mock" };
  const { roles } = getLlmConfig();
  return { extract: roles.extract.model, synthesize: roles.synthesize.model };
}
