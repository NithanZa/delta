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
};

export type LlmResponse = { content: string; usage: LlmUsage };

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
      timeout: opts.timeoutMs ?? 90_000,
      maxRetries: 1,
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
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.2,
    });
    const content = res.choices[0]?.message?.content ?? "";
    return {
      content,
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
 */
export async function callJson<T>(args: CallJsonArgs<T>): Promise<CallJsonResult<T>> {
  const client = args.client ?? getLlmClient();
  const model = args.model ?? MODELS.fast;
  const usage: LlmUsage = { promptTokens: 0, completionTokens: 0 };
  let user = args.user;
  let lastError = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    let res: LlmResponse;
    try {
      res = await client.complete({ ...args, model, user });
    } catch (e) {
      throw new LlmError(`StepFun call failed (${args.task}, ${model}): ${(e as Error).message}`, e);
    }
    usage.promptTokens += res.usage.promptTokens;
    usage.completionTokens += res.usage.completionTokens;
    const parsed = tryParse(res.content, args.schema);
    if (parsed.ok) return { data: parsed.data, usage, attempts: attempt };
    lastError = parsed.error;
    user = `${args.user}\n\nYour previous response was rejected. ${lastError}\nRespond again with valid JSON only, matching the required shape exactly.`;
  }
  throw new LlmError(`StepFun returned invalid output twice (${args.task}, ${model}): ${lastError}`);
}
