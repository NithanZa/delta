import { describe, expect, it } from "vitest";
import { evidenceOf, findSupersededInsight, fingerprint, jaccard, noveltyOf, scoreInsight, stem, titleTokens } from "./rank";

describe("rank", () => {
  it("tokenises titles with stop-words removed and crude stemming", () => {
    expect(stem("agencies")).toBe("agency");
    expect(stem("pricing")).toBe("pric");
    expect(stem("threatens")).toBe("threaten");
    expect([...titleTokens("Buffer's Agency Partner Program threatens Loop's referral-led growth")]).toEqual(["buffer", "agency", "partner", "program", "threaten", "loop", "referral", "led", "growth"]);
  });

  it("fingerprints are stable across word order and hypothesis order, and change with the topic", () => {
    const a = fingerprint([3, 1], "Buffer achieves feature parity on agency approvals and reporting");
    const b = fingerprint([1, 3], "Feature parity on agency approvals and reporting achieved by Buffer");
    const c = fingerprint([1, 3], "Buffer launches a public API with MCP and CLI");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
  });

  it("detects an update by explicit id, or by title similarity on the same hypothesis set", () => {
    const active = [
      { id: 10, title: "Buffer achieves feature parity on agency approvals and reporting", hypothesisIds: [1, 3] },
      { id: 11, title: "Buffer's guest access roadmap threatens Loop's client-workspace differentiation", hypothesisIds: [5] },
    ];
    expect(findSupersededInsight({ title: "Something unrelated entirely", hypothesisIds: [9], updatesInsightId: 11 }, active)?.id).toBe(11);
    expect(findSupersededInsight({ title: "Buffer reaches feature parity on approvals and reporting for agencies", hypothesisIds: [3, 1], updatesInsightId: null }, active)?.id).toBe(10);
    // Same words, different hypothesis set → not an update.
    expect(findSupersededInsight({ title: "Buffer reaches feature parity on approvals and reporting for agencies", hypothesisIds: [1], updatesInsightId: null }, active)).toBeUndefined();
    // Same hypotheses, different topic → not an update.
    expect(findSupersededInsight({ title: "Buffer raises Team plan price to $12 per channel", hypothesisIds: [1, 3], updatesInsightId: null }, active)).toBeUndefined();
    // An explicit id that is not active falls back to similarity.
    expect(findSupersededInsight({ title: "Buffer raises Team plan price", hypothesisIds: [1, 3], updatesInsightId: 999 }, active)).toBeUndefined();
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3);
  });

  it("applies the novelty rules", () => {
    expect(noveltyOf({ isNew: true, citesChange: false, maxHypothesisMove: 0 })).toBe(1);
    expect(noveltyOf({ isNew: false, citesChange: true, maxHypothesisMove: 0 })).toBe(0.7);
    expect(noveltyOf({ isNew: false, citesChange: false, maxHypothesisMove: 0.12 })).toBe(0.5);
    expect(noveltyOf({ isNew: false, citesChange: false, maxHypothesisMove: 0.05 })).toBe(0.2);
  });

  it("scores with the 35/25/25/15 weights and clamps to [0, 1]", () => {
    expect(evidenceOf([{ importance: 5 }, { importance: 3 }], [{ confidence: 0.8 }])).toBeCloseTo(0.5 * (4 / 5) + 0.5 * 0.8);
    expect(evidenceOf([], [])).toBe(0);
    const { score, breakdown } = scoreInsight({ relevance: 5, actionability: 4, novelty: 1, evidence: 0.8 });
    expect(breakdown).toEqual({ relevance: 1, novelty: 1, evidence: 0.8, actionability: 0.8 });
    expect(score).toBeCloseTo(0.35 + 0.25 + 0.2 + 0.12, 3);
    expect(scoreInsight({ relevance: 1, actionability: 1, novelty: 0.2, evidence: 0 }).score).toBeCloseTo(0.07 + 0.05 + 0.03, 3);
    expect(scoreInsight({ relevance: 9, actionability: 9, novelty: 2, evidence: 2 }).score).toBe(1);
  });
});
