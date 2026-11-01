import { describe, expect, it } from "vitest";
import { createDb, schema } from "@/db";
import { hashContent, insertSnapshotRecord } from "@/lib/ingest/snapshot";
import { formatResearchState, loadResearchState, PRIOR_FACT_CAP, selectPriorFactsForPrompt } from "./state";

const TOTAL_FACTS = 80;

/** A competitor with two finished runs' worth of facts, one active and one retired hypothesis, and a profile. */
function setup() {
  const db = createDb(":memory:");
  db.insert(schema.company).values({ name: "Loop" }).run();
  const comp = db.insert(schema.competitors).values({ name: "Buffer", slug: "buffer" }).returning().get();
  const text = "Buffer pricing. Agency plans start at $120 per month for up to 10 channels.";
  const { snapshot } = insertSnapshotRecord(db, comp.id, {
    url: "https://buffer.com/pricing",
    sourceType: "pricing",
    provider: "seeded",
    title: "Pricing",
    publishedAt: "2023-06-17",
    fetchedAt: "2026-10-31T00:00:00.000Z",
    archiveUrl: null,
    rawHtml: "",
    extractedText: text,
    contentHash: hashContent(text),
  });
  const run1 = db.insert(schema.runs).values({ competitorId: comp.id, label: "Run 1", cutoffDate: "2023-12-31", status: "done" }).returning().get();
  const run2 = db.insert(schema.runs).values({ competitorId: comp.id, label: "Run 2", cutoffDate: "2024-12-31", status: "done" }).returning().get();

  // Importance cycles 1..5 and dates spread over 80 days; every 10th fact is a detected change.
  const facts = db
    .insert(schema.facts)
    .values(
      Array.from({ length: TOTAL_FACTS }, (_, i) => ({
        runId: i < 40 ? run1.id : run2.id,
        competitorId: comp.id,
        snapshotId: snapshot.id,
        statement: `Fact ${i + 1} about pricing or product`,
        quote: `quote ${i + 1}`,
        category: "pricing" as const,
        eventDate: `2023-06-${String((i % 28) + 1).padStart(2, "0")}`,
        importance: (i % 5) + 1,
        isChange: i % 10 === 9,
      })),
    )
    .returning()
    .all();
  const low = facts.filter((f) => f.importance === 1 && !f.isChange).map((f) => f.id);

  // Active hypothesis: two updates citing low-importance facts (only those updates are pinned).
  const active = db
    .insert(schema.hypotheses)
    .values({ competitorId: comp.id, dimension: "customers", statement: "Investing in agencies", confidence: 0.6, status: "strengthened", createdRunId: run1.id, updatedRunId: run2.id })
    .returning()
    .get();
  db.insert(schema.hypothesisUpdates).values({ hypothesisId: active.id, runId: run1.id, change: "created", newConfidence: 0.5, reasoning: "r", factIds: [low[0], low[1]] }).run();
  db.insert(schema.hypothesisUpdates).values({ hypothesisId: active.id, runId: run2.id, change: "strengthened", newConfidence: 0.6, reasoning: "r", factIds: [low[2]] }).run();
  // Retired hypothesis: its citations must NOT pin anything.
  const retired = db
    .insert(schema.hypotheses)
    .values({ competitorId: comp.id, dimension: "distribution", statement: "No partner program", confidence: 0.4, status: "retired", createdRunId: run1.id, updatedRunId: run2.id })
    .returning()
    .get();
  db.insert(schema.hypothesisUpdates).values({ hypothesisId: retired.id, runId: run1.id, change: "created", newConfidence: 0.4, reasoning: "r", factIds: [low[3]] }).run();

  // Two profiles; only the latest one's fact ids count.
  const dim = (factIds: number[]) => ({ summary: "s", confidence: 0.5, factIds });
  const empty = dim([]);
  db.insert(schema.strategyProfiles).values({ competitorId: comp.id, runId: run1.id, profile: { customers: dim([low[4]]), productDirection: empty, positioning: empty, distribution: empty, businessModel: empty } }).run();
  db.insert(schema.strategyProfiles).values({ competitorId: comp.id, runId: run2.id, profile: { customers: dim([low[5]]), productDirection: empty, positioning: empty, distribution: dim([low[6]]), businessModel: empty } }).run();

  return { db, comp, facts, low };
}

describe("loadResearchState", () => {
  it("pins facts cited by active hypotheses and the latest profile only", () => {
    const { db, comp, low } = setup();
    const state = loadResearchState(db, comp.id);
    expect(state.priorFacts).toHaveLength(TOTAL_FACTS);
    expect(state.hypotheses.map((h) => h.statement)).toEqual(["Investing in agencies"]);
    expect([...state.pinnedFactIds].sort((a, b) => a - b)).toEqual([low[0], low[1], low[2], low[5], low[6]].sort((a, b) => a - b));
    expect(state.pinnedFactIds.has(low[3])).toBe(false); // retired hypothesis
    expect(state.pinnedFactIds.has(low[4])).toBe(false); // older profile
  });
});

describe("selectPriorFactsForPrompt", () => {
  it("keeps every cited and change fact, fills with the most important others, and respects the cap", () => {
    const { db, comp, facts, low } = setup();
    const state = loadResearchState(db, comp.id);
    const shown = selectPriorFactsForPrompt(state);
    const shownIds = new Set(shown.map((f) => f.id));

    const changes = facts.filter((f) => f.isChange);
    expect(changes.length).toBe(8);
    for (const f of changes) expect(shownIds.has(f.id)).toBe(true);
    for (const id of [low[0], low[1], low[2], low[5], low[6]]) expect(shownIds.has(id)).toBe(true);

    // Pinned + changes always survive; the rest is capped.
    const pinnedOrChange = facts.filter((f) => f.isChange || state.pinnedFactIds.has(f.id)).length;
    expect(shown.length).toBe(Math.min(TOTAL_FACTS, pinnedOrChange + PRIOR_FACT_CAP));
    expect(shown.length).toBeLessThan(TOTAL_FACTS);

    // The dropped facts are all importance-1 ones that nothing cites: everything of importance >= 2 made it.
    const dropped = facts.filter((f) => !shownIds.has(f.id));
    expect(dropped.length).toBeGreaterThan(0);
    for (const f of dropped) {
      expect(f.importance).toBe(1);
      expect(f.isChange).toBe(false);
      expect(state.pinnedFactIds.has(f.id)).toBe(false);
    }
    // Ids are the real DB ids and the chronological order of priorFacts is preserved.
    expect(shown.map((f) => f.id)).toEqual(state.priorFacts.filter((f) => shownIds.has(f.id)).map((f) => f.id));
  });

  it("prefers newer facts among equal importance and honors a custom cap", () => {
    const { db, comp } = setup();
    const state = loadResearchState(db, comp.id);
    const shown = selectPriorFactsForPrompt(state, 3);
    const filler = shown.filter((f) => !f.isChange && !state.pinnedFactIds.has(f.id));
    expect(filler).toHaveLength(3);
    for (const f of filler) expect(f.importance).toBe(5);
    const dates = filler.map((f) => f.eventDate!).sort();
    const allTop = state.priorFacts.filter((f) => f.importance === 5 && !f.isChange).map((f) => f.eventDate!).sort();
    expect(dates).toEqual(allTop.slice(-3));
  });

  it("shows everything when there are fewer facts than the cap", () => {
    const { db, comp } = setup();
    const state = loadResearchState(db, comp.id);
    state.priorFacts = state.priorFacts.slice(0, 20);
    expect(selectPriorFactsForPrompt(state)).toHaveLength(20);
  });
});

describe("formatResearchState", () => {
  it("renders the shown subset with a count note and real F ids", () => {
    const { db, comp, facts } = setup();
    const state = loadResearchState(db, comp.id);
    const shown = selectPriorFactsForPrompt(state);
    const text = formatResearchState(state);
    expect(text).toContain(`(showing ${shown.length} of ${TOTAL_FACTS} earlier facts: all cited facts and detected changes plus the most important others)`);
    const rendered = Array.from(text.matchAll(/^F(\d+) /gm), (m) => Number(m[1]));
    expect(rendered).toEqual(shown.map((f) => f.id));
    for (const f of facts.filter((f) => f.isChange)) expect(text).toContain(`F${f.id} [`);
    expect(text).toContain(" CHANGE ");
  });

  it("says (none) on the first run", () => {
    const db = createDb(":memory:");
    db.insert(schema.company).values({ name: "Loop" }).run();
    const comp = db.insert(schema.competitors).values({ name: "Buffer", slug: "buffer" }).returning().get();
    const text = formatResearchState(loadResearchState(db, comp.id));
    expect(text).toContain("## Facts already known from earlier runs (compact; cite as F<id>)\n(none)");
    expect(text).not.toContain("showing");
  });
});
