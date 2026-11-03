/**
 * Insight de-duplication and scoring. Pure functions; `runInsights` applies them.
 *
 * score = 0.35·relevance/5 + 0.25·novelty + 0.25·evidence + 0.15·actionability/5
 */
import { createHash } from "node:crypto";
import type { Fact, Hypothesis, Insight, ScoreBreakdown } from "@/db/schema";
import { DEDUPE_JACCARD, HYPOTHESIS_MOVE_MIN } from "@/lib/digest/thresholds";

const STOPWORDS = new Set(
  "a an the and or of to in on for with by from at as is are was were be been being this that these those it its into over under than then via vs versus not no yes new now more most less own our your their his her they them we you i s t".split(" "),
);

/** Crude suffix stripping: "pricing" → "pric", "agencies" → "agency", "threatens" → "threaten". */
export function stem(word: string): string {
  let w = word;
  for (const suffix of ["ations", "ation", "ings", "ing", "ies", "ed", "es", "ly", "s"]) {
    if (w.length - suffix.length >= 3 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      if (suffix === "ies") w += "y";
      break;
    }
  }
  return w;
}

export function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[’']/g, "")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t))
      .map(stem),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Stable identity of an insight's topic: its hypothesis set plus its five most frequent title stems. */
export function fingerprint(hypothesisIds: number[], title: string): string {
  const counts = new Map<string, number>();
  for (const raw of title.toLowerCase().replace(/[’']/g, "").split(/[^a-z0-9]+/)) {
    if (raw.length <= 1 || STOPWORDS.has(raw)) continue;
    const s = stem(raw);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([t]) => t);
  const material = `${[...hypothesisIds].sort((a, b) => a - b).join(",")}|${top.join(" ")}`;
  return createHash("sha1").update(material).digest("hex");
}

const sameSet = (a: number[], b: number[]) => a.length === b.length && [...a].sort((x, y) => x - y).every((v, i) => v === [...b].sort((x, y) => x - y)[i]);

/**
 * The active insight a new one replaces: the model's explicit `updatesInsightId`
 * when it points at an active insight, else a title match (Jaccard ≥ 0.6) on the
 * same hypothesis set.
 */
export function findSupersededInsight(
  candidate: { title: string; hypothesisIds: number[]; updatesInsightId: number | null },
  active: Pick<Insight, "id" | "title" | "hypothesisIds">[],
): Pick<Insight, "id" | "title" | "hypothesisIds"> | undefined {
  if (candidate.updatesInsightId !== null) {
    const explicit = active.find((i) => i.id === candidate.updatesInsightId);
    if (explicit) return explicit;
  }
  const tokens = titleTokens(candidate.title);
  let best: { insight: (typeof active)[number]; sim: number } | undefined;
  for (const i of active) {
    if (!sameSet(i.hypothesisIds, candidate.hypothesisIds)) continue;
    const sim = jaccard(tokens, titleTokens(i.title));
    if (sim >= DEDUPE_JACCARD && (!best || sim > best.sim)) best = { insight: i, sim };
  }
  return best?.insight;
}

export type NoveltyInput = {
  /** No active insight on the topic. */
  isNew: boolean;
  /** Replacing an older insight and citing at least one change fact. */
  citesChange: boolean;
  /** Largest confidence move (absolute) among cited hypotheses this run. */
  maxHypothesisMove: number;
};

export function noveltyOf(input: NoveltyInput): number {
  if (input.isNew) return 1;
  if (input.citesChange) return 0.7;
  if (input.maxHypothesisMove + 1e-9 >= HYPOTHESIS_MOVE_MIN) return 0.5;
  return 0.2;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** 0.5·mean(cited fact importance)/5 + 0.5·mean(cited hypothesis confidence). */
export function evidenceOf(facts: Pick<Fact, "importance">[], hypotheses: Pick<Hypothesis, "confidence">[]): number {
  return 0.5 * (mean(facts.map((f) => f.importance)) / 5) + 0.5 * mean(hypotheses.map((h) => h.confidence));
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));

export function scoreInsight(input: { relevance: number; actionability: number; novelty: number; evidence: number }): { score: number; breakdown: ScoreBreakdown } {
  const breakdown: ScoreBreakdown = {
    relevance: clamp(input.relevance / 5),
    novelty: clamp(input.novelty),
    evidence: clamp(input.evidence),
    actionability: clamp(input.actionability / 5),
  };
  const score = clamp(0.35 * breakdown.relevance + 0.25 * breakdown.novelty + 0.25 * breakdown.evidence + 0.15 * breakdown.actionability);
  return { score: Math.round(score * 1000) / 1000, breakdown };
}
