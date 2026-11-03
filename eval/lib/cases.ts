/**
 * Regression case format and matcher evaluation.
 *
 * A matcher is a flat object whose keys name a field on the row under test:
 *   - `<field>Matches`: case-insensitive regex on String(row.field)
 *   - `<field>Min` / `<field>Max`: numeric bounds on row.field
 *   - anything else: strict equality with row.field
 * A field missing on the row never matches (so expectations on columns a later
 * phase adds, e.g. `billingCadence`, stay red until that phase lands).
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { DIMENSIONS, FACT_CATEGORIES } from "@/db/schema";

export const CASES_DIR = path.resolve(process.cwd(), "eval", "cases");
export const FIXTURES_DIR = path.join(CASES_DIR, "fixtures");

const Matcher = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));
export type Matcher = z.infer<typeof Matcher>;

const Expectation = z.object({
  /** Each matcher must match at least one item. */
  mustInclude: z.array(Matcher).optional(),
  /** No item may match any of these. */
  mustNotInclude: z.array(Matcher).optional(),
  /** Every item must match. */
  allMatch: Matcher.optional(),
  /** For every item matching `where`, `must` has to match too. */
  allMatching: z.array(z.object({ where: Matcher, must: Matcher })).optional(),
  min: z.number().int().optional(),
  max: z.number().int().optional(),
});
export type Expectation = z.infer<typeof Expectation>;

const SnapshotSpec = z.object({
  key: z.string().optional(),
  url: z.string().url(),
  sourceType: z.string(),
  title: z.string().optional(),
  publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  textFile: z.string(),
});
export type SnapshotSpec = z.infer<typeof SnapshotSpec>;

const FactSpec = z.object({
  key: z.string().optional(),
  /** `key` of a snapshot in `state.snapshots`. */
  snapshot: z.string(),
  statement: z.string(),
  /** Must be verbatim in the fixture text (G1 runs on the case database). */
  quote: z.string(),
  category: z.enum(FACT_CATEGORIES),
  eventDate: z.string().nullable().optional(),
  importance: z.number().int().min(1).max(5).default(3),
  isChange: z.boolean().default(false),
});
export type FactSpec = z.infer<typeof FactSpec>;

const HypothesisSpec = z.object({
  key: z.string(),
  dimension: z.enum(DIMENSIONS),
  statement: z.string(),
  confidence: z.number().min(0).max(1),
  status: z.enum(["active", "strengthened", "weakened", "contradicted", "revised"]).default("active"),
  userCorrection: z.string().optional(),
  /** Keys of prior facts cited by the "created" update. */
  factKeys: z.array(z.string()).default([]),
});

const State = z.object({
  snapshots: z.array(SnapshotSpec),
  /** Cutoff of the earlier run that produced the prior facts (defaults to the case cutoff). */
  priorCutoff: z.string().optional(),
  priorFacts: z.array(FactSpec).default([]),
  hypotheses: z.array(HypothesisSpec).default([]),
  openQuestions: z.array(z.string()).default([]),
  newFacts: z.array(FactSpec).default([]),
});

export const EvalCase = z.object({
  id: z.string().regex(/^E\d{2}[a-z]?$/),
  kind: z.enum(["extract", "change", "synthesis", "insights"]),
  description: z.string().optional(),
  /** Audit finding this case encodes and the phase expected to turn it green. */
  source: z.string().optional(),
  competitor: z.object({ name: z.string(), slug: z.string(), website: z.string().optional() }).default({ name: "Buffer", slug: "buffer", website: "https://buffer.com" }),
  researchQuestions: z.array(z.string()).default(["Is the competitor investing in agencies as a segment?", "How is pricing changing?"]),
  cutoff: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** extract: the page. */
  snapshot: SnapshotSpec.optional(),
  /** change: two captures of the same URL. */
  previous: SnapshotSpec.optional(),
  current: SnapshotSpec.optional(),
  /** Additional pages present in the database but not analysed (e.g. a product page that still exists). */
  extraSnapshots: z.array(SnapshotSpec).default([]),
  /** synthesis / insights: the prepared record. */
  state: State.optional(),
  /**
   * Canned model output per task, used instead of the real model so a code
   * path is exercised deterministically. Strings "{{F:n}}", "{{H:n}}" and
   * "{{Q:n}}" are replaced by the n-th new fact / hypothesis / open question id.
   */
  mock: z.record(z.string(), z.unknown()).optional(),
  expect: z.object({
    facts: Expectation.optional(),
    changes: Expectation.optional(),
    hypothesisUpdates: Expectation.optional(),
    openQuestions: Expectation.optional(),
    /** Per strategy-profile dimension. */
    profile: z.record(z.string(), Matcher).optional(),
    insights: Expectation.optional(),
    /** Regex the thrown error must match; the case fails if nothing throws. */
    throws: z.string().optional(),
  }),
});
export type EvalCase = z.infer<typeof EvalCase>;

export function loadCases(dir = CASES_DIR): EvalCase[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      const parsed = EvalCase.safeParse(raw);
      if (!parsed.success) throw new Error(`Invalid case ${f}: ${parsed.error.message}`);
      return parsed.data;
    });
}

export function readFixture(file: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, file), "utf8");
}

export type Row = Record<string, unknown>;

export function matches(row: Row, matcher: Matcher): boolean {
  for (const [key, expected] of Object.entries(matcher)) {
    if (key.endsWith("Matches")) {
      const field = key.slice(0, -"Matches".length);
      const value = row[field];
      if (value === undefined || value === null) return false;
      if (!new RegExp(String(expected), "i").test(String(value))) return false;
    } else if (key.endsWith("Min") || key.endsWith("Max")) {
      const field = key.slice(0, -3);
      const value = row[field];
      if (typeof value !== "number" || typeof expected !== "number") return false;
      if (key.endsWith("Min") ? value < expected : value > expected) return false;
    } else if (row[key] !== expected) {
      return false;
    }
  }
  return true;
}

const describe = (m: Matcher) => JSON.stringify(m);

/** Returns human-readable failures (empty when the expectation holds). */
export function evaluate(label: string, items: Row[], exp: Expectation): string[] {
  const failures: string[] = [];
  if (exp.min !== undefined && items.length < exp.min) failures.push(`${label}: expected at least ${exp.min} item(s), got ${items.length}`);
  if (exp.max !== undefined && items.length > exp.max) failures.push(`${label}: expected at most ${exp.max} item(s), got ${items.length}`);
  for (const m of exp.mustInclude ?? []) {
    if (!items.some((it) => matches(it, m))) failures.push(`${label}: no item matches ${describe(m)}`);
  }
  for (const m of exp.mustNotInclude ?? []) {
    const hits = items.filter((it) => matches(it, m));
    if (hits.length) failures.push(`${label}: ${hits.length} item(s) match forbidden ${describe(m)}: ${hits.map((h) => excerpt(h)).join(" | ")}`);
  }
  if (exp.allMatch) {
    const bad = items.filter((it) => !matches(it, exp.allMatch!));
    if (bad.length) failures.push(`${label}: ${bad.length} item(s) do not match ${describe(exp.allMatch)}: ${bad.map((b) => excerpt(b)).join(" | ")}`);
  }
  for (const rule of exp.allMatching ?? []) {
    const bad = items.filter((it) => matches(it, rule.where) && !matches(it, rule.must));
    if (bad.length) failures.push(`${label}: ${bad.length} item(s) matching ${describe(rule.where)} violate ${describe(rule.must)}: ${bad.map((b) => excerpt(b)).join(" | ")}`);
  }
  return failures;
}

export function excerpt(row: Row, max = 140): string {
  const text = String(row.statement ?? row.question ?? row.title ?? row.summary ?? row.reasoning ?? JSON.stringify(row));
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
