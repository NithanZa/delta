/**
 * Deterministic trust gates. They read a Delta database and report
 * zero-tolerance failures: quotes that are not in their page, facts dated
 * after the run cutoff that produced them, dangling ids, out-of-range
 * confidences and uncited conclusions. Used by `npm run eval:gates`, by the
 * regression runner on each case database, and (phase 7) before a digest is sent.
 */
import { sql } from "drizzle-orm";
import { createDb, type Db } from "@/db";
import { quoteIsVerbatim } from "@/lib/pipeline/verbatim";

export type GateId = "G1" | "G2" | "G3" | "G4" | "G5";

export type GateResult = {
  id: GateId;
  name: string;
  /** Rows examined. */
  checked: number;
  /** Human-readable ids of offending rows (all of them; callers truncate for display). */
  violations: string[];
};

export type GateReport = { results: GateResult[]; passed: boolean };

export type GateOptions = {
  /** Restrict G1/G2 to these fact ids (phase 7 checks a digest's cited facts). */
  factIds?: number[];
};

/** Open a database for gate checks: migrations run on open, then the connection is made read-only. */
export function openReadOnly(dbPath: string): Db {
  const db = createDb(dbPath);
  db.run(sql`pragma query_only = 1`);
  return db;
}

function hasColumn(db: Db, table: string, column: string): boolean {
  const cols = db.all<{ name: string }>(sql.raw(`pragma table_info(${table})`));
  return cols.some((c) => c.name === column);
}

function parseIds(json: unknown): number[] {
  if (Array.isArray(json)) return json.filter((x): x is number => typeof x === "number");
  if (typeof json === "string") {
    try {
      const v = JSON.parse(json);
      return Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : [];
    } catch {
      return [];
    }
  }
  return [];
}

type FactRow = {
  id: number;
  quote: string;
  isChange: number;
  snapshotId: number;
  competitorId: number;
  runId: number;
  claimKind: string | null;
};
type SnapshotRow = { id: number; sourceId: number; publishedAt: string; extractedText: string; competitorId: number };

function loadSnapshots(db: Db): Map<number, SnapshotRow> {
  const rows = db.all<SnapshotRow>(
    sql`select id, source_id as sourceId, published_at as publishedAt, extracted_text as extractedText, competitor_id as competitorId from snapshots`,
  );
  return new Map(rows.map((s) => [s.id, s]));
}

function loadFacts(db: Db, only?: number[]): FactRow[] {
  const claimKind = hasColumn(db, "facts", "claim_kind") ? sql.raw("claim_kind") : sql.raw("null");
  const rows = db.all<FactRow>(
    sql`select id, quote, is_change as isChange, snapshot_id as snapshotId, competitor_id as competitorId, run_id as runId, ${claimKind} as claimKind from facts`,
  );
  if (!only) return rows;
  const keep = new Set(only);
  return rows.filter((f) => keep.has(f.id));
}

/** G1: every stored quote appears verbatim in its page (or, for change facts, in an earlier capture of the same source). */
export function gateQuotes(db: Db, opts: GateOptions = {}): GateResult {
  const snapshots = loadSnapshots(db);
  const bySource = new Map<number, SnapshotRow[]>();
  for (const s of snapshots.values()) bySource.set(s.sourceId, [...(bySource.get(s.sourceId) ?? []), s]);
  const violations: string[] = [];
  let checked = 0;
  for (const f of loadFacts(db, opts.factIds)) {
    if (f.claimKind === "absence") continue; // absence facts record what was *not* found; their quote is the check description
    checked++;
    const snap = snapshots.get(f.snapshotId);
    if (!snap) {
      violations.push(`F${f.id} (snapshot ${f.snapshotId} missing)`);
      continue;
    }
    const texts = [snap.extractedText];
    if (f.isChange) {
      for (const other of bySource.get(snap.sourceId) ?? []) {
        if (other.id !== snap.id && other.publishedAt <= snap.publishedAt) texts.push(other.extractedText);
      }
    }
    if (!texts.some((t) => quoteIsVerbatim(f.quote, t))) violations.push(`F${f.id}`);
  }
  return { id: "G1", name: "Quotes verbatim in source", checked, violations };
}

/** G2: no fact, hypothesis update or insight rests on a page dated after the cutoff of the run that produced it. */
export function gatePointInTime(db: Db, opts: GateOptions = {}): GateResult {
  const snapshots = loadSnapshots(db);
  const runs = new Map(db.all<{ id: number; cutoffDate: string }>(sql`select id, cutoff_date as cutoffDate from runs`).map((r) => [r.id, r.cutoffDate]));
  const facts = loadFacts(db);
  const factDate = new Map<number, string>();
  for (const f of facts) factDate.set(f.id, snapshots.get(f.snapshotId)?.publishedAt ?? "9999-12-31");
  const only = opts.factIds ? new Set(opts.factIds) : null;

  const violations: string[] = [];
  let checked = 0;
  for (const f of facts) {
    if (only && !only.has(f.id)) continue;
    checked++;
    const cutoff = runs.get(f.runId);
    if (!cutoff) {
      violations.push(`F${f.id} (run ${f.runId} missing)`);
      continue;
    }
    if (factDate.get(f.id)! > cutoff) violations.push(`F${f.id} (${factDate.get(f.id)} > ${cutoff})`);
  }
  const citing = [
    { table: "hypothesis_updates", prefix: "HU", column: "fact_ids" },
    { table: "insights", prefix: "I", column: "fact_ids" },
    { table: "timeline_events", prefix: "E", column: "fact_ids" },
  ];
  for (const c of citing) {
    const rows = db.all<{ id: number; runId: number; ids: string }>(sql.raw(`select id, run_id as runId, ${c.column} as ids from ${c.table}`));
    for (const r of rows) {
      const cutoff = runs.get(r.runId);
      const ids = parseIds(r.ids).filter((id) => !only || only.has(id));
      if (ids.length === 0) continue;
      checked++;
      const late = ids.filter((id) => (factDate.get(id) ?? "0000") > (cutoff ?? "0000"));
      if (late.length) violations.push(`${c.prefix}${r.id} cites ${late.map((id) => `F${id}`).join(",")} dated after ${cutoff}`);
    }
  }
  return { id: "G2", name: "Point-in-time (no cutoff leakage)", checked, violations };
}

/** G3: every cited id resolves to a row of the same competitor. */
export function gateIdIntegrity(db: Db): GateResult {
  const factComp = new Map(db.all<{ id: number; c: number }>(sql`select id, competitor_id as c from facts`).map((r) => [r.id, r.c]));
  const hypComp = new Map(db.all<{ id: number; c: number }>(sql`select id, competitor_id as c from hypotheses`).map((r) => [r.id, r.c]));
  const eventComp = new Map(db.all<{ id: number; c: number }>(sql`select id, competitor_id as c from timeline_events`).map((r) => [r.id, r.c]));
  const violations: string[] = [];
  let checked = 0;
  const check = (label: string, competitorId: number, ids: number[], lookup: Map<number, number>, prefix: string) => {
    checked++;
    const bad = ids.filter((id) => lookup.get(id) !== competitorId);
    if (bad.length) violations.push(`${label} → ${bad.map((id) => `${prefix}${id}`).join(",")}`);
  };

  for (const u of db.all<{ id: number; c: number; ids: string }>(
    sql`select u.id, h.competitor_id as c, u.fact_ids as ids from hypothesis_updates u join hypotheses h on h.id = u.hypothesis_id`,
  )) {
    check(`HU${u.id}`, u.c, parseIds(u.ids), factComp, "F");
  }
  for (const i of db.all<{ id: number; c: number; f: string; h: string }>(sql`select id, competitor_id as c, fact_ids as f, hypothesis_ids as h from insights`)) {
    check(`I${i.id}`, i.c, parseIds(i.f), factComp, "F");
    check(`I${i.id}`, i.c, parseIds(i.h), hypComp, "H");
  }
  for (const e of db.all<{ id: number; c: number; f: string; r: string }>(sql`select id, competitor_id as c, fact_ids as f, related_event_ids as r from timeline_events`)) {
    check(`E${e.id}`, e.c, parseIds(e.f), factComp, "F");
    check(`E${e.id}`, e.c, parseIds(e.r), eventComp, "E");
  }
  for (const p of db.all<{ id: number; c: number; profile: string }>(sql`select id, competitor_id as c, profile from strategy_profiles`)) {
    let parsed: Record<string, { factIds?: unknown }> = {};
    try {
      parsed = typeof p.profile === "string" ? JSON.parse(p.profile) : (p.profile as never);
    } catch {
      violations.push(`P${p.id} profile is not JSON`);
      continue;
    }
    for (const [dim, d] of Object.entries(parsed)) check(`P${p.id}.${dim}`, p.c, parseIds(d?.factIds), factComp, "F");
  }
  return { id: "G3", name: "Cited ids resolve (same competitor)", checked, violations };
}

/** G4: confidences strictly inside (0, 1); a hypothesis that supersedes another points at a retired row. */
export function gateConfidence(db: Db): GateResult {
  const violations: string[] = [];
  let checked = 0;
  const inRange = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1;
  const hyps = db.all<{ id: number; confidence: number; status: string; supersedesId: number | null }>(
    sql`select id, confidence, status, supersedes_id as supersedesId from hypotheses`,
  );
  const byId = new Map(hyps.map((h) => [h.id, h]));
  for (const h of hyps) {
    checked++;
    if (!inRange(h.confidence)) violations.push(`H${h.id} confidence ${h.confidence}`);
    if (h.supersedesId !== null) {
      const parent = byId.get(h.supersedesId);
      if (!parent) violations.push(`H${h.id} supersedes missing H${h.supersedesId}`);
      else if (parent.status !== "retired") violations.push(`H${h.id} supersedes H${parent.id} which is ${parent.status}, not retired`);
    }
  }
  for (const u of db.all<{ id: number; newConfidence: number; prevConfidence: number | null }>(
    sql`select id, new_confidence as newConfidence, prev_confidence as prevConfidence from hypothesis_updates`,
  )) {
    checked++;
    if (!inRange(u.newConfidence)) violations.push(`HU${u.id} newConfidence ${u.newConfidence}`);
    if (u.prevConfidence !== null && !inRange(u.prevConfidence)) violations.push(`HU${u.id} prevConfidence ${u.prevConfidence}`);
  }
  return { id: "G4", name: "Confidence sanity", checked, violations };
}

/** G5: every insight and every non-retired hypothesis update cites at least one fact. */
export function gateCitations(db: Db): GateResult {
  const violations: string[] = [];
  let checked = 0;
  for (const i of db.all<{ id: number; ids: string }>(sql`select id, fact_ids as ids from insights`)) {
    checked++;
    if (parseIds(i.ids).length === 0) violations.push(`I${i.id}`);
  }
  for (const u of db.all<{ id: number; change: string; ids: string }>(sql`select id, change, fact_ids as ids from hypothesis_updates`)) {
    if (u.change === "retired") continue;
    checked++;
    if (parseIds(u.ids).length === 0) violations.push(`HU${u.id} (${u.change})`);
  }
  return { id: "G5", name: "Citations present", checked, violations };
}

export function runGates(db: Db, opts: GateOptions = {}): GateReport {
  const results = [gateQuotes(db, opts), gatePointInTime(db, opts), gateIdIntegrity(db), gateConfidence(db), gateCitations(db)];
  return { results, passed: results.every((r) => r.violations.length === 0) };
}

/** Quotes and point-in-time only, for a set of facts (digest pre-send check). */
export function runFactGates(db: Db, factIds: number[]): GateReport {
  const results = [gateQuotes(db, { factIds }), gatePointInTime(db, { factIds })];
  return { results, passed: results.every((r) => r.violations.length === 0) };
}

export function exitCodeFor(report: GateReport): 0 | 1 {
  return report.passed ? 0 : 1;
}

export function formatReport(report: GateReport, maxIds = 10): string {
  const lines = ["| Gate | Check | Rows | Violations | Status | First offenders |", "|---|---|---:|---:|---|---|"];
  for (const r of report.results) {
    const status = r.violations.length === 0 ? "PASS" : "FAIL";
    lines.push(`| ${r.id} | ${r.name} | ${r.checked} | ${r.violations.length} | ${status} | ${r.violations.slice(0, maxIds).join(", ")} |`);
  }
  lines.push("", report.passed ? "All gates passed." : "GATES FAILED.");
  return lines.join("\n");
}
