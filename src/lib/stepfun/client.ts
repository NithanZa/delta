import OpenAI from "openai";
import type { ZodType } from "zod";
import { env } from "@/lib/env";
import { MockLlmClient } from "./mock";

export const MODELS = {
  /** step-3.7-flash: fast, cheap, JSON-mode; per-page extraction and diffing. */
  fast: "step-3.7-flash",
  /** step-5-preview: 1M context; cross-source synthesis and recommendations. */
  deep: "step-5-preview",
} as const;

export type LlmTask = "extract_facts" | "detect_change" | "synthesize" | "generate_insights" | "smoke";

export type LlmUsage = { promptTokens: number; completionTokens: number };

export type LlmRequest = {
  task: LlmTask;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /** step-3.7-flash supports low/medium/high; omit for models that do not. */
  reasoningEffort?: "low" | "medium" | "high";
};

export type LlmResponse = { content: string; usage: LlmUsage; truncated?: boolean };

export interface LlmClient {
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/** OpenAI-compatible transport pointed at StepFun. */
export class StepFunClient implements LlmClient {
  private readonly openai: OpenAI;

  constructor(opts: { apiKey?: string; baseURL?: string; timeoutMs?: number } = {}) {
    this.openai = new OpenAI({
      apiKey: opts.apiKey ?? env.stepfunApiKey,
      baseURL: opts.baseURL ?? env.stepfunBaseUrl,
      timeout: opts.timeoutMs ?? 180_000,
      // The SDK backs off on 429/5xx/network errors; the API key has a small concurrency limit.
      maxRetries: 4,
    });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const res = await this.openai.chat.completions.create({
      model: req.model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      response_format: { type: "json_object" },
      max_tokens: req.maxTokens ?? 8192,
      temperature: req.temperature ?? 0.2,
      ...(req.reasoningEffort ? { reasoning_effort: req.reasoningEffort } : {}),
    });
    const choice = res.choices[0];
    return {
      content: choice?.message?.content ?? "",
      truncated: choice?.finish_reason === "length",
      usage: {
        promptTokens: res.usage?.prompt_tokens ?? 0,
        completionTokens: res.usage?.completion_tokens ?? 0,
      },
    };
  }
}

let defaultClient: LlmClient | undefined;

export function getLlmClient(): LlmClient {
  if (!defaultClient) {
    defaultClient = env.mockLlm ? new MockLlmClient() : new StepFunClient();
  }
  return defaultClient;
}

/** Test hook: replace the default client. */
export function setLlmClient(client: LlmClient | undefined) {
  defaultClient = client;
}

export type CallJsonArgs<T> = Omit<LlmRequest, "model"> & {
  model?: string;
  schema: ZodType<T>;
  client?: LlmClient;
};

export type CallJsonResult<T> = { data: T; usage: LlmUsage; attempts: number };

function stripFences(s: string): string {
  const trimmed = s.trim();
  const m = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1] : trimmed;
}

function tryParse<T>(content: string, schema: ZodType<T>): { ok: true; data: T } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(stripFences(content));
  } catch (e) {
    return { ok: false, error: `Response was not valid JSON: ${(e as Error).message}` };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: `Response did not match the schema: ${parsed.error.message.slice(0, 1500)}` };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Call a model in JSON mode and validate the result against a Zod schema.
 * On invalid JSON or schema mismatch, retries once with the error appended.
 * When the output was cut off at max_tokens, the retry doubles the budget
 * (reasoning models spend part of the budget thinking before the JSON).
 */
export async function callJson<T>(args: CallJsonArgs<T>): Promise<CallJsonResult<T>> {
  const client = args.client ?? getLlmClient();
  const model = args.model ?? MODELS.fast;
  const usage: LlmUsage = { promptTokens: 0, completionTokens: 0 };
  let user = args.user;
  let maxTokens = args.maxTokens ?? 8192;
  let lastError = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    let res: LlmResponse;
    try {
      res = await client.complete({ ...args, model, user, maxTokens });
    } catch (e) {
      throw new LlmError(`StepFun call failed (${args.task}, ${model}): ${(e as Error).message}`, e);
    }
    usage.promptTokens += res.usage.promptTokens;
    usage.completionTokens += res.usage.completionTokens;
    const parsed = tryParse(res.content, args.schema);
    if (parsed.ok) return { data: parsed.data, usage, attempts: attempt };
    if (res.truncated) {
      lastError = `Output was cut off at max_tokens=${maxTokens}. ${parsed.error}`;
      maxTokens *= 2;
      user = `${args.user}\n\nYour previous response was cut off before the JSON was complete. Be more concise and respond with valid JSON only.`;
    } else {
      lastError = parsed.error;
      user = `${args.user}\n\nYour previous response was rejected. ${lastError}\nRespond again with valid JSON only, matching the required shape exactly.`;
    }
  }
  throw new LlmError(`StepFun returned invalid output twice (${args.task}, ${model}): ${lastError}`);
}
