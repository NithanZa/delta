import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { isOpenAiApi, type LlmConfig, type RoleConfig } from "./config";

/**
 * Provider name for the OpenAI-compatible adapter. The AI SDK reads
 * `providerOptions[<name>]` and its camelCase form, so a camelCase name keeps
 * both spellings identical.
 */
export const OPENAI_COMPAT_PROVIDER = "openaiCompat";

/** Instantiate the AI SDK model for one role. Throws when the provider's credentials are missing. */
export function createLanguageModel(role: RoleConfig, config: LlmConfig): LanguageModel {
  if (role.provider === "anthropic") {
    if (!config.anthropicApiKey) {
      throw new Error(`ANTHROPIC_API_KEY is not set but ${role.model} is configured (set it, or point LLM_EXTRACT/LLM_SYNTH at openai:<model>)`);
    }
    return createAnthropic({ apiKey: config.anthropicApiKey })(role.model);
  }
  if (!config.openaiCompat.apiKey) {
    throw new Error(`OPENAI_COMPAT_API_KEY (or STEPFUN_API_KEY) is not set but ${role.model} is configured`);
  }
  return createOpenAICompatible({
    name: OPENAI_COMPAT_PROVIDER,
    baseURL: config.openaiCompat.baseUrl,
    apiKey: config.openaiCompat.apiKey,
    // The adapter sends `max_tokens`, which OpenAI's current models reject with a 400.
    transformRequestBody: isOpenAiApi(config.openaiCompat.baseUrl)
      ? ({ max_tokens, ...body }) => ({ ...body, max_completion_tokens: max_tokens })
      : undefined,
  })(role.model);
}
