/**
 * Thin fetch wrappers over Exa's search and contents endpoints (shapes
 * verified 2026-11-02; see docs/plans/prototype/phase8-discovery.md).
 */
import { env } from "@/lib/env";
import { recordUsage } from "@/lib/usage";

export const EXA_BASE = "https://api.exa.ai";

export type ExaCategory = "company" | "publication" | "news" | "personal site" | "financial report" | "people";

export type ExaSearchBody = {
  query: string;
  type?: "auto" | "lite" | "deep-lite" | "deep";
  category?: ExaCategory;
  numResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  /** ISO 8601 date-time. Ignored by the `company` and `people` categories. */
  startPublishedDate?: string;
  endPublishedDate?: string;
  contents?: { text: true | { maxCharacters: number } };
};

export type ExaResult = {
  id: string;
  url: string;
  title: string | null;
  /** YYYY-MM-DD, estimated by Exa. */
  publishedDate?: string | null;
  author?: string | null;
  text?: string;
  score?: number;
};

export type ExaSearchResponse = { requestId?: string; results: ExaResult[]; costDollars?: { total?: number } | number };
export type ExaContentsResponse = { results: { id: string; url: string; title: string | null; text?: string }[]; statuses?: { id: string; status: string; source?: string; error?: unknown }[]; costDollars?: unknown };

export type ExaOptions = {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  timeoutMs?: number;
  retryDelayMs?: number;
  /** What this request is for, shown on /usage. */
  task?: string;
};

export class ExaError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ExaError";
  }
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

async function post<T>(path: string, body: unknown, opts: ExaOptions): Promise<T> {
  const apiKey = opts.apiKey ?? env.exaApiKey;
  if (!apiKey) throw new ExaError("EXA_API_KEY is not set", 0);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const delay = opts.retryDelayMs ?? 1500;
  let lastError: Error = new ExaError("no attempt made", 0);
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
    try {
      const res = await fetchImpl(`${EXA_BASE}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      if (res.ok) {
        const parsed = JSON.parse(text) as T & { costDollars?: unknown };
        recordUsage({ service: "exa", provider: "exa.ai", model: path.slice(1), task: opts.task ?? "other", costUsd: reportedCost(parsed) });
        return parsed;
      }
      const err = new ExaError(`Exa ${path} returned HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
      if (res.status === 429 || res.status >= 500) {
        lastError = err;
        await sleep(delay * (attempt + 1));
        continue;
      }
      throw err;
    } catch (e) {
      if (e instanceof ExaError) throw e;
      lastError = new ExaError(`Exa ${path} failed: ${(e as Error).name === "AbortError" ? "timed out" : (e as Error).message}`, 0);
      await sleep(delay * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function reportedCost(res: { costDollars?: unknown }): number | null {
  const c = res.costDollars;
  if (typeof c === "number") return c;
  if (c && typeof c === "object" && typeof (c as { total?: unknown }).total === "number") return (c as { total: number }).total;
  return null;
}

/** Cost reported by Exa for a response, in USD (0 when absent). */
export function exaCost(res: { costDollars?: unknown }): number {
  return reportedCost(res) ?? 0;
}

export function exaSearch(body: ExaSearchBody, opts: ExaOptions = {}): Promise<ExaSearchResponse> {
  return post<ExaSearchResponse>("/search", { type: "auto", ...body }, opts);
}

/** Page text for URLs; `maxAgeHours: 0` forces a fresh crawl, omit it to allow Exa's cache. */
export function exaContents(urls: string[], opts: ExaOptions & { maxCharacters?: number; maxAgeHours?: number } = {}): Promise<ExaContentsResponse> {
  return post<ExaContentsResponse>("/contents", { ids: urls, text: { maxCharacters: opts.maxCharacters ?? 60_000 }, ...(opts.maxAgeHours !== undefined ? { maxAgeHours: opts.maxAgeHours } : {}) }, opts);
}

export function exaConfigured(): boolean {
  return Boolean(env.exaApiKey);
}
