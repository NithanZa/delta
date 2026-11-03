/**
 * Wayback Machine CDX client (shapes verified 2026-11-02; see
 * docs/plans/prototype/phase10-backfill.md). One request per second, retries
 * on 429/503 honouring Retry-After, and a per-job call budget.
 */
import { USER_AGENT } from "./fetchPage";

export const CDX_URL = "https://web.archive.org/cdx/search/cdx";

export type Capture = { timestamp: string; original: string; digest: string; date: string };

export class CdxBudget {
  used = 0;
  constructor(readonly max = 200) {}
  take() {
    if (this.used >= this.max) throw new Error(`CDX call budget of ${this.max} exhausted`);
    this.used++;
  }
}

export type CdxOptions = {
  /** yyyyMMdd[hhmmss], inclusive. */
  from?: string;
  to?: string;
  /** collapse=timestamp:N (6 = one capture per month). */
  collapse?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retryDelayMs?: number;
  minGapMs?: number;
  budget?: CdxBudget;
};

let lastRequestAt = 0;
const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** Parse CDX `output=json`: the first row is the header. */
export function parseCdx(json: unknown): Capture[] {
  if (!Array.isArray(json) || json.length === 0) return [];
  const [header, ...rows] = json as string[][];
  const col = (name: string) => header.indexOf(name);
  const ts = col("timestamp");
  const orig = col("original");
  const dig = col("digest");
  if (ts === -1 || orig === -1) throw new Error("CDX response is missing the timestamp/original columns");
  return rows
    .filter((r) => Array.isArray(r) && r[ts])
    .map((r) => ({ timestamp: r[ts], original: r[orig], digest: dig === -1 ? "" : (r[dig] ?? ""), date: `${r[ts].slice(0, 4)}-${r[ts].slice(4, 6)}-${r[ts].slice(6, 8)}` }));
}

export async function listCaptures(url: string, opts: CdxOptions = {}): Promise<Capture[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const params = new URLSearchParams({ url, output: "json", fl: "timestamp,original,statuscode,digest", filter: "statuscode:200", collapse: opts.collapse ?? "timestamp:6" });
  if (opts.from) params.set("from", opts.from);
  if (opts.to) params.set("to", opts.to);
  const target = `${CDX_URL}?${params.toString()}`;
  const gap = opts.minGapMs ?? 1000;
  let lastError: Error = new Error("no attempt");
  for (let attempt = 0; attempt < 4; attempt++) {
    opts.budget?.take();
    const wait = lastRequestAt + gap - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
    try {
      const res = await fetchImpl(target, { headers: { "user-agent": USER_AGENT, accept: "application/json" }, signal: controller.signal });
      if (res.status === 429 || res.status === 503) {
        const retryAfter = Number(res.headers.get("retry-after"));
        lastError = new Error(`CDX returned HTTP ${res.status}`);
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : (opts.retryDelayMs ?? 5000) * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`CDX returned HTTP ${res.status} for ${url}`);
      const text = await res.text();
      return text.trim() ? parseCdx(JSON.parse(text)) : [];
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        lastError = new Error(`CDX timed out for ${url}`);
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

/** The latest capture dated on or before the cutoff. */
export function pickCaptureBefore(captures: Capture[], cutoffDate: string): Capture | undefined {
  return captures.filter((c) => c.date <= cutoffDate).sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
}
