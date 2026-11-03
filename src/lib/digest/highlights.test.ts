import { describe, expect, it } from "vitest";
import type { Insight } from "@/db/schema";
import type { ChangeItem, CompetitorDigest, HypothesisMove } from "./content";
import { collapseMoves, moreInAppLabel, selectAllHighlights, selectHighlights } from "./highlights";

const insight = (id: number, score: number, severity: Insight["severity"] = "high") => ({ id, score, severity, title: `I${id}` }) as Insight;
let nextUpdate = 1;
const move = (hypothesisId: number, change: HypothesisMove["change"], prev: number | null, next: number, supersedesId: number | null = null) =>
  ({ hypothesis: { id: hypothesisId, statement: `H${hypothesisId}`, supersedesId }, prev, next, change, reasoning: "", update: { id: nextUpdate++ } }) as unknown as HypothesisMove;
const change = (id: number, importance: number, publishedAt = "2026-11-01") => ({ fact: { id, importance, statement: `F${id}` }, snapshot: { publishedAt, url: "https://a.example" }, previousSnapshot: undefined }) as unknown as ChangeItem;

const digest = (over: Partial<CompetitorDigest>) =>
  ({ competitor: { id: 1, name: "Buffer", slug: "buffer" }, runs: [], hypothesesMoved: [], topInsights: [], moreInsights: [], changes: [], questionsResolved: [], questionsRaised: [], conflicts: [], pagesChecked: 0, pagesChanged: 0, ...over }) as CompetitorDigest;

describe("selectHighlights", () => {
  it("caps every section however much the week produced", () => {
    const h = selectHighlights(
      digest({
        topInsights: [insight(1, 0.8), insight(2, 0.8), insight(3, 0.8)],
        hypothesesMoved: [move(1, "created", null, 0.7), move(2, "created", null, 0.7), move(3, "created", null, 0.7)],
        changes: [change(1, 4), change(2, 4), change(3, 4), change(4, 4)],
        conflicts: [{ id: 1 }, { id: 2 }] as CompetitorDigest["conflicts"],
      }),
    );
    expect([h.insights.length, h.moves.length, h.changes.length, h.conflicts.length]).toEqual([2, 2, 3, 1]);
  });

  it("does not mention what was left out when none of it is very important", () => {
    const h = selectHighlights(digest({ topInsights: [insight(1, 0.95), insight(2, 0.9), insight(3, 0.85)], moreInsights: [insight(4, 0.95, "medium")], hypothesesMoved: [move(1, "created", null, 0.7), move(2, "created", null, 0.7), move(3, "created", null, 0.7)], changes: [change(1, 4), change(2, 4), change(3, 4), change(4, 4)] }));
    expect(h.more).toEqual({ insights: 0, moves: 0, changes: 0 });
    expect(moreInAppLabel(h.more)).toBeNull();
  });

  it("counts what was left out only when it clears the very-important bar, with a readable label", () => {
    const h = selectHighlights(digest({ topInsights: [insight(1, 0.95), insight(2, 0.95), insight(3, 0.92)], moreInsights: [insight(4, 0.91)], hypothesesMoved: [move(1, "revised", 0.4, 0.7), move(2, "revised", 0.4, 0.7), move(3, "strengthened", 0.4, 0.65)], changes: [change(1, 5), change(2, 5), change(3, 5), change(4, 5)] }));
    expect(h.more).toEqual({ insights: 2, moves: 1, changes: 1 });
    expect(moreInAppLabel(h.more)).toBe("2 more insights, 1 more theory update and 1 more change");
    expect(moreInAppLabel({ insights: 0, moves: 0, changes: 1 })).toBe("1 more change");
  });

  it("leaves out small moves, weak new theories, low-severity insights and minor changes", () => {
    const h = selectHighlights(digest({ topInsights: [insight(1, 0.9, "low")], hypothesesMoved: [move(1, "strengthened", 0.6, 0.65), move(2, "created", null, 0.5)], changes: [change(1, 3)] }));
    expect(h.hasNews).toBe(false);
  });

  it("puts changed views ahead of new theories, and the most important changes first", () => {
    const h = selectHighlights(digest({ hypothesesMoved: [move(1, "created", null, 0.8), move(2, "revised", 0.5, 0.6)], changes: [change(1, 4, "2026-11-02"), change(2, 5, "2026-01-01")] }));
    expect(h.moves.map((m) => m.change)).toEqual(["revised", "created"]);
    expect(h.changes.map((c) => c.fact.id)).toEqual([2, 1]);
  });
});

describe("collapseMoves", () => {
  it("hides a retirement that a revision replaced, which was the '70% → 70% = retired' line", () => {
    const out = collapseMoves([move(45, "retired", 0.7, 0.7), move(51, "revised", 0.7, 0.75, 45)]);
    expect(out.map((m) => m.hypothesis.id)).toEqual([51]);
  });

  it("keeps a theory that was dropped with nothing replacing it", () => {
    expect(collapseMoves([move(9, "retired", 0.5, 0.5)]).map((m) => m.change)).toEqual(["retired"]);
  });

  it("merges several updates to one theory, from its first value to its last", () => {
    const [m] = collapseMoves([move(7, "strengthened", 0.4, 0.5), move(7, "strengthened", 0.5, 0.7)]);
    expect([m.prev, m.next]).toEqual([0.4, 0.7]);
  });
});

describe("selectAllHighlights", () => {
  it("puts the competitor with the most important news first and quiet ones last", () => {
    const quiet = digest({ competitor: { id: 1, name: "Quiet", slug: "q" } as CompetitorDigest["competitor"] });
    const some = digest({ competitor: { id: 2, name: "Some", slug: "s" } as CompetitorDigest["competitor"], topInsights: [insight(1, 0.7)] });
    const big = digest({ competitor: { id: 3, name: "Big", slug: "b" } as CompetitorDigest["competitor"], topInsights: [insight(2, 0.9)] });
    expect(selectAllHighlights([quiet, some, big]).map((h) => h.digest.competitor.name)).toEqual(["Big", "Some", "Quiet"]);
  });
});
