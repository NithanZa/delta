/**
 * Which Wayback captures to fetch for which cutoffs: one capture per watched
 * URL per cutoff, skipping cutoffs where the content did not change.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { SourceType } from "@/db/schema";
import { CdxBudget, listCaptures, pickCaptureBefore, type Capture, type CdxOptions } from "@/lib/ingest/wayback";

export type BackfillStep = "quarter" | "month";

export type PlannedFetch = { url: string; sourceType: SourceType; timestamp: string; date: string; digest: string };
export type PlannedCutoff = { cutoffDate: string; fetches: PlannedFetch[]; skipped: { url: string; reason: string }[] };
export type BackfillPlan = {
  competitorId: number;
  months: number;
  step: BackfillStep;
  cutoffs: PlannedCutoff[];
  estimate: { pages: number; runs: number; cdxCalls: number };
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Last day of each period from `now - months` to the last completed period, ascending. */
export function periodEnds(now: Date, months: number, step: BackfillStep): string[] {
  const size = step === "quarter" ? 3 : 1;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  const ends: string[] = [];
  // First period end at or after the start, aligned to the step (quarters end in Mar/Jun/Sep/Dec).
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  if (step === "quarter") m = Math.floor(m / 3) * 3 + 2;
  for (;;) {
    const end = new Date(Date.UTC(y, m + 1, 0)); // last day of month m
    if (end >= now) break;
    ends.push(iso(end));
    m += size;
    if (m > 11) {
      m -= 12;
      y += 1;
    }
  }
  return ends;
}

export type PlanOptions = {
  months?: number;
  step?: BackfillStep;
  now?: Date;
  cdx?: CdxOptions;
  /** Injected capture lister (tests). */
  listCapturesImpl?: (url: string, opts: CdxOptions) => Promise<Capture[]>;
  log?: (m: string) => void;
};

export async function planBackfill(db: Db, competitorId: number, opts: PlanOptions = {}): Promise<BackfillPlan> {
  const months = opts.months ?? 24;
  const step = opts.step ?? "quarter";
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const list = opts.listCapturesImpl ?? listCaptures;
  const budget = opts.cdx?.budget ?? new CdxBudget(200);
  const cutoffDates = periodEnds(now, months, step);
  const sources = db
    .select()
    .from(schema.sources)
    .where(and(eq(schema.sources.competitorId, competitorId), eq(schema.sources.watch, true), eq(schema.sources.enabled, true)))
    .all()
    .filter((s) => /^https?:\/\//.test(s.url));
  const cutoffs: PlannedCutoff[] = cutoffDates.map((cutoffDate) => ({ cutoffDate, fetches: [], skipped: [] }));
  if (cutoffDates.length === 0 || sources.length === 0) return { competitorId, months, step, cutoffs, estimate: { pages: 0, runs: 0, cdxCalls: 0 } };

  const first = new Date(`${cutoffDates[0]}T00:00:00Z`);
  const from = iso(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() - 3, 1))).replace(/-/g, "");
  const to = iso(now).replace(/-/g, "");
  let cdxCalls = 0;
  for (const source of sources) {
    let captures: Capture[];
    try {
      captures = await list(source.url, { ...opts.cdx, from, to, budget });
      cdxCalls++;
    } catch (e) {
      log(`CDX failed for ${source.url}: ${(e as Error).message}`);
      for (const c of cutoffs) c.skipped.push({ url: source.url, reason: `CDX failed: ${(e as Error).message.slice(0, 80)}` });
      continue;
    }
    let previousDigest: string | null = null;
    for (const c of cutoffs) {
      const pick = pickCaptureBefore(captures, c.cutoffDate);
      if (!pick) {
        c.skipped.push({ url: source.url, reason: "no capture before this cutoff" });
        continue;
      }
      if (pick.digest && pick.digest === previousDigest) {
        c.skipped.push({ url: source.url, reason: `unchanged since ${pick.date} (same digest)` });
        continue;
      }
      previousDigest = pick.digest || null;
      c.fetches.push({ url: source.url, sourceType: source.sourceType, timestamp: pick.timestamp, date: pick.date, digest: pick.digest });
    }
    log(`${source.url}: ${captures.length} capture(s) in range`);
  }
  const pages = cutoffs.reduce((n, c) => n + c.fetches.length, 0);
  return { competitorId, months, step, cutoffs, estimate: { pages, runs: cutoffs.filter((c) => c.fetches.length > 0).length, cdxCalls } };
}

export function formatPlan(plan: BackfillPlan, sources: { url: string }[]): string {
  const lines = [`${plan.cutoffs.length} ${plan.step}ly cutoff(s), ${sources.length} watched URL(s): ${plan.estimate.pages} page fetch(es), ${plan.estimate.runs} run(s), ${plan.estimate.cdxCalls} CDX call(s)`];
  for (const c of plan.cutoffs) {
    lines.push(`\n≤ ${c.cutoffDate}`);
    for (const f of c.fetches) lines.push(`  fetch   ${f.url}  @ ${f.timestamp} (${f.date})`);
    for (const s of c.skipped) lines.push(`  skip    ${s.url}  — ${s.reason}`);
  }
  return lines.join("\n");
}
