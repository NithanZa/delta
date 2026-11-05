import type { ZodType } from "zod";
import { env } from "@/lib/env";
import { AiSdkClient } from "./aiSdk";
import { MockLlmClient } from "./mock";

/** Which stage of the pipeline is calling; each role maps to a configured provider:model. */
export type LlmRole = "extract" | "synthesize";
export type LlmEffort = "low" | "medium" | "high";
export type LlmTask = "extract_facts" | "detect_change" | "synthesize" | "generate_insights" | "assess_relevance" | "group_stories" | "draft_company" | "draft_competitor" | "write_digest" | "smoke";

export type LlmUsage = {
  /** Total input tokens, including the cached part. */
  promptTokens: number;
  completionTokens: number;
  /** Input tokens served from the prompt cache (subset of promptTokens). */
  cacheReadTokens?: number;
  /** Input tokens written to the prompt cache (subset of promptTokens). */
  cacheWriteTokens?: number;
};

export type LlmRequest = {
  task: LlmTask;
  role: LlmRole;
  system: string;
  user: string;
  maxTokens?: number;
  /** Reasoning depth; defaults to the role's configured effort. */
  effort?: LlmEffort;
  /** Strict JSON-schema-compatible shape handed to providers that support structured outputs. */
  wire?: ZodType;
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

export const DEFAULT_MAX_TOKENS: Record<LlmRole, number> = { extract: 8192, synthesize: 16_000 };

export function emptyUsage(): LlmUsage {
  return { promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

/** Add `u` into `total` (mutates and returns `total`). */
export function addUsage(total: LlmUsage, u: LlmUsage): LlmUsage {
  total.promptTokens += u.promptTokens;
  total.completionTokens += u.completionTokens;
  total.cacheReadTokens = (total.cacheReadTokens ?? 0) + (u.cacheReadTokens ?? 0);
  total.cacheWriteTokens = (total.cacheWriteTokens ?? 0) + (u.cacheWriteTokens ?? 0);
  return total;
}

let defaultClient: LlmClient | undefined;

/** The configured client. One instance serves both roles; the role on each request picks the model. */
export function getLlmClient(): LlmClient {
  if (!defaultClient) {
    defaultClient = env.mockLlm ? new MockLlmClient() : new AiSdkClient();
  }
  return defaultClient;
}

/** Test hook: replace the default client (undefined restores lazy creation). */
export function setLlmClient(client: LlmClient | undefined) {
  defaultClient = client;
}

export type CallJsonArgs<T> = LlmRequest & {
  /** Lenient schema: validates and normalises the model output for every provider. */
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
 * Call the model configured for `role` in JSON mode and validate the result
 * against the lenient Zod `schema` (the single normalisation path for every
 * provider). Providers with structured outputs also receive `wire`.
 * On invalid JSON or schema mismatch, retries once with the error appended.
 * When the output was cut off at max_tokens, the retry doubles the budget
 * (reasoning models spend part of the budget thinking before the JSON).
 */
export async function callJson<T>(args: CallJsonArgs<T>): Promise<CallJsonResult<T>> {
  const { schema, client: given, ...request } = args;
  const client = given ?? getLlmClient();
  const usage = emptyUsage();
  let user = request.user;
  let maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS[request.role];
  let lastError = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    let res: LlmResponse;
    try {
      res = await client.complete({ ...request, user, maxTokens });
    } catch (e) {
      throw new LlmError(`Model call failed (${request.task}, role ${request.role}): ${(e as Error).message}`, e);
    }
    addUsage(usage, res.usage);
    const parsed = tryParse(res.content, schema);
    if (parsed.ok) return { data: parsed.data, usage, attempts: attempt };
    if (res.truncated) {
      lastError = `Output was cut off at max_tokens=${maxTokens}. ${parsed.error}`;
      maxTokens *= 2;
      user = `${request.user}\n\nYour previous response was cut off before the JSON was complete. Be more concise and respond with valid JSON only.`;
    } else {
      lastError = parsed.error;
      user = `${request.user}\n\nYour previous response was rejected. ${lastError}\nRespond again with valid JSON only, matching the required shape exactly.`;
    }
  }
  throw new LlmError(`Model returned invalid output twice (${request.task}, role ${request.role}): ${lastError}`);
}
