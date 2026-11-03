import { generateText, NoObjectGeneratedError, Output, type LanguageModel } from "ai";
import type { LlmClient, LlmRequest, LlmResponse, LlmRole, LlmUsage } from "./client";
import { DEFAULT_MAX_TOKENS, LlmError } from "./client";
import { billingProvider, getLlmConfig, type LlmConfig } from "./config";
import { estimateCostUsd } from "./pricing";
import { createLanguageModel, OPENAI_COMPAT_PROVIDER } from "./providers";
import { recordUsage } from "@/lib/usage";

/** Requests can take several minutes on reasoning models; the AI SDK timeout is in milliseconds. */
const TIMEOUT_MS = 600_000;
const MAX_RETRIES = 3;

export type AiSdkClientOptions = {
  config?: LlmConfig;
  /** Pre-built models per role (tests inject MockLanguageModelV4 here). */
  models?: Partial<Record<LlmRole, LanguageModel>>;
};

/**
 * One `LlmClient` for every provider, built on the Vercel AI SDK. The role on
 * each request selects the configured provider:model. Anthropic models get
 * structured outputs (`Output.object` with the strict wire schema), a cached
 * system prompt and `effort`; OpenAI-compatible models get JSON mode,
 * `temperature` and `reasoning_effort` when the model supports it.
 */
export class AiSdkClient implements LlmClient {
  private readonly config: LlmConfig;
  private readonly models: Partial<Record<LlmRole, LanguageModel>>;

  constructor(opts: AiSdkClientOptions = {}) {
    this.config = opts.config ?? getLlmConfig();
    this.models = { ...opts.models };
  }

  private model(role: LlmRole): LanguageModel {
    let m = this.models[role];
    if (!m) {
      m = createLanguageModel(this.config.roles[role], this.config);
      this.models[role] = m;
    }
    return m;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const role = this.config.roles[req.role];
    const model = this.model(req.role);
    const effort = req.effort ?? role.effort;
    const maxOutputTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS[req.role];
    const anthropic = role.provider === "anthropic";
    // Every answer back from the provider is billed, including ones callJson then rejects and retries.
    const billed = (u: SdkUsage | undefined): LlmUsage => {
      const usage = toUsage(u);
      recordUsage({ service: "llm", provider: billingProvider(role, this.config.openaiCompat.baseUrl), model: role.model, task: req.task, ...usage, costUsd: estimateCostUsd(role.model, usage) });
      return usage;
    };

    try {
      const result = await generateText({
        model,
        // The system prompt is byte-stable per competitor, so one cache breakpoint on it pays off across the pages of a run.
        instructions: anthropic
          ? [{ role: "system", content: req.system, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }]
          : req.system,
        prompt: req.user,
        maxOutputTokens,
        maxRetries: MAX_RETRIES,
        timeout: TIMEOUT_MS,
        // Claude 5.x models reject non-default sampling parameters; OpenAI-compatible models keep a low temperature for JSON.
        ...(anthropic ? {} : { temperature: this.config.openaiCompat.temperature }),
        output: anthropic ? (req.wire ? Output.object({ schema: req.wire }) : Output.text()) : Output.json(),
        providerOptions: anthropic
          ? { anthropic: { effort } }
          : role.supportsReasoningEffort
            ? { [OPENAI_COMPAT_PROVIDER]: { reasoningEffort: effort } }
            : undefined,
      });

      const usage = billed(result.usage);
      if (result.finishReason === "content-filter") {
        throw new LlmError(`refusal: the model declined to answer (${req.task}, ${role.model}, ${result.rawFinishReason ?? "content-filter"})`);
      }
      let content = result.text;
      if (!content.trim()) {
        // JSON-tool fallback mode returns the object without text; serialise it so the lenient parse still runs.
        try {
          const out = result.output as unknown;
          if (out !== undefined && out !== null) content = JSON.stringify(out);
        } catch {
          // No parsable output: an empty string makes callJson retry with the error appended.
        }
      }
      return { content, truncated: result.finishReason === "length", usage };
    } catch (e) {
      // The SDK validates structured outputs eagerly; hand the raw text back so callJson's retry path applies.
      if (NoObjectGeneratedError.isInstance(e)) {
        return { content: e.text ?? "", truncated: e.finishReason === "length", usage: billed(e.usage) };
      }
      throw e;
    }
  }
}

type SdkUsage = {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number };
};

export function toUsage(u: SdkUsage | undefined): LlmUsage {
  return {
    promptTokens: u?.inputTokens ?? 0,
    completionTokens: u?.outputTokens ?? 0,
    cacheReadTokens: u?.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteTokens: u?.inputTokenDetails?.cacheWriteTokens ?? 0,
  };
}
