/**
 * Stratified labeling sample for the weekly precision check. For n = 25: 10
 * change facts, 5 pages checked with no change, 5 hypothesis updates, 5 random
 * insights or facts. Other n scale proportionally; short strata are filled from
 * the others. Columns are documented in eval/labels/README.md.
 */
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { Db } from "@/db";

type Row = { id: string; kind: string; text: string; quote: string; source_url: string; published_at: string; confidence: string };

export type SampleResult = { file: string; rows: number; requested: number; runs: number; pools: { changeFacts: number; quietPages: number; updates: number; insights: number; facts: number } };

/** Deterministic shuffle so a re-run on the same database gives the same sheet. */
function seeded(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export function writeLabelSample(db: Db, opts: { since: string; n?: number; out: string; seed?: string }): SampleResult | null {
  const n = opts.n ?? 25;
  const rand = seeded(opts.seed ?? `${opts.since}:${n}`);
  const shuffle = <T>(xs: T[]) => xs.map((x) => [rand(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);

  const runIds = db.all<{ id: number }>(sql`select id from runs where status = 'done' and kind <> 'check' and coalesce(started_at, finished_at, '') >= ${opts.since}`).map((r) => r.id);
  if (runIds.length === 0) return null;
  const inRuns = sql.join(runIds.map((id) => sql`${id}`), sql`, `);

  const factRows = db.all<{ id: number; statement: string; quote: string; url: string; published_at: string; is_change: number }>(
    sql`select f.id, f.statement, f.quote, s.url, s.published_at, f.is_change from facts f join snapshots s on s.id = f.snapshot_id where f.run_id in (${inRuns})`,
  );
  const changeFacts: Row[] = factRows.filter((f) => f.is_change).map((f) => ({ id: `F${f.id}`, kind: "change_fact", text: f.statement, quote: f.quote, source_url: f.url, published_at: f.published_at, confidence: "" }));
  const plainFacts: Row[] = factRows.filter((f) => !f.is_change).map((f) => ({ id: `F${f.id}`, kind: "fact", text: f.statement, quote: f.quote, source_url: f.url, published_at: f.published_at, confidence: "" }));

  const quietPages: Row[] = db
    .all<{ id: number; url: string; title: string | null; published_at: string }>(
      sql`select s.id, s.url, s.title, s.published_at from snapshots s where s.processed_run_id in (${inRuns}) and s.source_type <> 'internal' and s.url not like 'check://%'
          and exists (select 1 from snapshots p where p.source_id = s.source_id and p.id <> s.id and p.published_at < s.published_at)
          and not exists (select 1 from facts f where f.snapshot_id = s.id and f.is_change = 1)`,
    )
    .map((s) => ({ id: `S${s.id}`, kind: "page_no_change", text: `No change detected vs the previous capture: ${s.title ?? s.url}`, quote: "", source_url: s.url, published_at: s.published_at, confidence: "" }));

  const updates: Row[] = db
    .all<{ id: number; change: string; reasoning: string; new_confidence: number; statement: string; url: string | null; published_at: string | null }>(
      sql`select u.id, u.change, u.reasoning, u.new_confidence, h.statement,
            (select s.url from facts f join snapshots s on s.id = f.snapshot_id where f.id = cast(json_extract(u.fact_ids, '$[0]') as integer)) as url,
            (select s.published_at from facts f join snapshots s on s.id = f.snapshot_id where f.id = cast(json_extract(u.fact_ids, '$[0]') as integer)) as published_at
          from hypothesis_updates u join hypotheses h on h.id = u.hypothesis_id where u.run_id in (${inRuns})`,
    )
    .map((u) => ({ id: `HU${u.id}`, kind: `hypothesis_${u.change}`, text: `${u.statement} — ${u.reasoning}`, quote: "", source_url: u.url ?? "", published_at: u.published_at ?? "", confidence: u.new_confidence.toFixed(2) }));

  const insights: Row[] = db
    .all<{ id: number; title: string; what_happened: string; severity: string }>(sql`select id, title, what_happened, severity from insights where run_id in (${inRuns})`)
    .map((i) => ({ id: `I${i.id}`, kind: "insight", text: `${i.title} — ${i.what_happened}`, quote: "", source_url: "", published_at: "", confidence: i.severity }));

  const scale = n / 25;
  const want = { changes: Math.round(10 * scale), quiet: Math.round(5 * scale), updates: Math.round(5 * scale) };
  const mixed = Math.max(0, n - want.changes - want.quiet - want.updates);
  const picked: Row[] = [];
  const take = (pool: Row[], k: number) => {
    const chosen = shuffle(pool).slice(0, k);
    picked.push(...chosen);
    return chosen.length;
  };
  let short = 0;
  short += want.changes - take(changeFacts, want.changes);
  short += want.quiet - take(quietPages, want.quiet);
  short += want.updates - take(updates, want.updates);
  short += mixed - take(shuffle([...insights, ...plainFacts]), mixed);
  if (short > 0) {
    const used = new Set(picked.map((p) => p.id));
    take([...changeFacts, ...plainFacts, ...updates, ...insights, ...quietPages].filter((r) => !used.has(r.id)), short);
  }

  const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
  const header = ["id", "kind", "text", "quote", "source_url", "published_at", "confidence", "label", "note"];
  const lines = [header.join(","), ...picked.map((r) => [r.id, r.kind, r.text, r.quote, r.source_url, r.published_at, r.confidence, "", ""].map(esc).join(","))];
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, `${lines.join("\n")}\n`);
  return { file: opts.out, rows: picked.length, requested: n, runs: runIds.length, pools: { changeFacts: changeFacts.length, quietPages: quietPages.length, updates: updates.length, insights: insights.length, facts: plainFacts.length } };
}
