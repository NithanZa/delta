/**
 * What earns a place in the email. A digest is read in a minute, so each section
 * shows only its most notable items whatever the week produced, and "more in
 * Delta" appears only when what was left out is itself very important.
 */
import type { Insight } from "@/db/schema";
import type { ChangeItem, CompetitorDigest, HypothesisMove } from "./content";
import { effectiveScore } from "./content";
import { CHANGE_IMPORTANCE_MIN, CHANGE_VERY_IMPORTANT, EMAIL_CHANGES_MAX, EMAIL_CONFLICTS_MAX, EMAIL_INSIGHTS_MAX, EMAIL_MOVES_MAX, HYPOTHESIS_MOVE_MIN, INSIGHT_VERY_IMPORTANT_SCORE, MOVE_VERY_IMPORTANT, NEW_HYPOTHESIS_MIN_CONFIDENCE, NEW_HYPOTHESIS_VERY_CONFIDENT } from "./thresholds";

export type MoreInApp = { insights: number; moves: number; changes: number };

export type CompetitorHighlights = {
  digest: CompetitorDigest;
  insights: Insight[];
  moves: HypothesisMove[];
  changes: ChangeItem[];
  conflicts: CompetitorDigest["conflicts"];
  more: MoreInApp;
  hasNews: boolean;
};

const delta = (m: HypothesisMove) => (m.prev === null ? 0 : Math.abs(m.next - m.prev));

/**
 * The latest word on each hypothesis. A retirement is dropped when a revision in
 * the same period replaced it, because the revision already tells that story.
 */
export function collapseMoves(moves: HypothesisMove[]): HypothesisMove[] {
  const latest = new Map<number, HypothesisMove>();
  for (const m of moves) {
    const earlier = latest.get(m.hypothesis.id);
    latest.set(m.hypothesis.id, earlier ? { ...m, prev: earlier.prev } : m);
  }
  const replaced = new Set([...latest.values()].filter((m) => m.change === "revised").map((m) => m.hypothesis.supersedesId));
  return [...latest.values()].filter((m) => !(m.change === "retired" && replaced.has(m.hypothesis.id)));
}

function isWorthShowing(m: HypothesisMove): boolean {
  if (m.change === "created") return m.next + 1e-9 >= NEW_HYPOTHESIS_MIN_CONFIDENCE;
  if (m.change === "strengthened" || m.change === "weakened") return delta(m) + 1e-9 >= HYPOTHESIS_MOVE_MIN;
  return true;
}

/** Changing an existing view is bigger news than a new one, and a larger swing beats a smaller one. */
function moveRank(m: HypothesisMove): number {
  if (m.change === "revised" || m.change === "contradicted") return 1 + delta(m);
  if (m.change === "retired") return 0.9;
  if (m.change === "created") return m.next * 0.5;
  return delta(m) * 2;
}

function moveIsVeryImportant(m: HypothesisMove): boolean {
  if (m.change === "created") return m.next + 1e-9 >= NEW_HYPOTHESIS_VERY_CONFIDENT;
  if (m.change === "retired") return false;
  return delta(m) + 1e-9 >= MOVE_VERY_IMPORTANT;
}

const insightIsVeryImportant = (i: Insight) => i.severity === "high" && effectiveScore(i) + 1e-9 >= INSIGHT_VERY_IMPORTANT_SCORE;

export function selectHighlights(c: CompetitorDigest): CompetitorHighlights {
  const allInsights = [...c.topInsights, ...c.moreInsights].filter((i) => i.severity !== "low");
  const insights = allInsights.slice(0, EMAIL_INSIGHTS_MAX);

  const allMoves = collapseMoves(c.hypothesesMoved)
    .filter(isWorthShowing)
    .sort((a, b) => moveRank(b) - moveRank(a) || a.update.id - b.update.id);
  const moves = allMoves.slice(0, EMAIL_MOVES_MAX);

  const allChanges = c.changes
    .filter((ch) => ch.fact.importance >= CHANGE_IMPORTANCE_MIN)
    .sort((a, b) => b.fact.importance - a.fact.importance || b.snapshot.publishedAt.localeCompare(a.snapshot.publishedAt) || a.fact.id - b.fact.id);
  const changes = allChanges.slice(0, EMAIL_CHANGES_MAX);

  const conflicts = c.conflicts.slice(0, EMAIL_CONFLICTS_MAX);

  return {
    digest: c,
    insights,
    moves,
    changes,
    conflicts,
    more: {
      insights: allInsights.slice(EMAIL_INSIGHTS_MAX).filter(insightIsVeryImportant).length,
      moves: allMoves.slice(EMAIL_MOVES_MAX).filter(moveIsVeryImportant).length,
      changes: allChanges.slice(EMAIL_CHANGES_MAX).filter((ch) => ch.fact.importance >= CHANGE_VERY_IMPORTANT).length,
    },
    hasNews: insights.length + moves.length + changes.length + conflicts.length > 0,
  };
}

/** Competitors with the most important news first; ones with none go last. */
export function selectAllHighlights(competitors: CompetitorDigest[]): CompetitorHighlights[] {
  const top = (h: CompetitorHighlights) => (h.insights[0] ? effectiveScore(h.insights[0]) : 0);
  return competitors.map(selectHighlights).sort((a, b) => Number(b.hasNews) - Number(a.hasNews) || top(b) - top(a));
}

/** "2 more insights and 1 more change", or null when nothing left out is very important. */
export function moreInAppLabel(more: MoreInApp): string | null {
  const part = (n: number, one: string, many: string) => (n > 0 ? `${n} more ${n === 1 ? one : many}` : null);
  const parts = [part(more.insights, "insight", "insights"), part(more.moves, "theory update", "theory updates"), part(more.changes, "change", "changes")].filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
