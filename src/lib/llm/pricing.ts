import { env } from "@/lib/env";
import type { LlmRole, LlmUsage } from "./client";
import type { LlmConfig } from "./config";

/** USD per million tokens. Missing cache prices fall back to the input price. */
export type ModelPrice = { input: number; output: number; cacheRead?: number; cacheWrite?: number };

/**
 * Anthropic list prices (Claude API reference, cached 2026-10-06): Haiku 5.5
 * 0.10/0.50 for prompts up to 100k tokens, Opus 5.5 4.00/20.00 (cache read
 * 0.20), Sonnet 5.5 2.00/10.00 (cache read 0.20). Cache writes are ~1.25x
 * input and Haiku cache reads ~0.1x input. OpenAI list prices from
 * developers.openai.com/api/docs/pricing, read 2026-11-03 (standard tier, prompts
 * up to 272k tokens; no separate charge for cache writes). Override with LLM_PRICES_JSON.
 */
export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "gpt-6-luna": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "gpt-6.1-sol": { input: 2, output: 10, cacheRead: 0.1 },
};

let overrides: Record<string, ModelPrice> | undefined;

function loadOverrides(): Record<string, ModelPrice> {
  if (overrides) return overrides;
  overrides = {};
  if (env.llmPricesJson) {
    try {
      const parsed = JSON.parse(env.llmPricesJson) as Record<string, ModelPrice>;
      for (const [model, price] of Object.entries(parsed)) {
        if (typeof price?.input === "number" && typeof price?.output === "number") overrides[model] = price;
      }
    } catch (e) {
      console.warn(`LLM_PRICES_JSON is not valid JSON and was ignored: ${(e as Error).message}`);
    }
  }
  return overrides;
}

/** Test hook. */
export function resetPriceOverrides(next?: Record<string, ModelPrice>) {
  overrides = next;
}

export function priceFor(model: string): ModelPrice | null {
  return loadOverrides()[model] ?? DEFAULT_PRICES[model] ?? null;
}

/** Estimated USD for one usage record on one model; null when the model has no known price. */
export function estimateCostUsd(model: string, usage: LlmUsage): number | null {
  const p = priceFor(model);
  if (!p) return null;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  const uncached = Math.max(0, usage.promptTokens - cacheRead - cacheWrite);
  const usd =
    (uncached * p.input + cacheRead * (p.cacheRead ?? p.input) + cacheWrite * (p.cacheWrite ?? p.input) + usage.completionTokens * p.output) /
    1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/** Sum over roles; null when any used role runs a model without a known price. */
export function estimateRunCostUsd(byRole: Partial<Record<LlmRole, LlmUsage>>, config: Pick<LlmConfig, "roles">): number | null {
  let total = 0;
  for (const [role, usage] of Object.entries(byRole) as [LlmRole, LlmUsage][]) {
    if (usage.promptTokens === 0 && usage.completionTokens === 0) continue;
    const cost = estimateCostUsd(config.roles[role].model, usage);
    if (cost === null) return null;
    total += cost;
  }
  return Math.round(total * 1_000_000) / 1_000_000;
}
