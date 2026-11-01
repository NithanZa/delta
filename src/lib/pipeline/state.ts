import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { Fact, Hypothesis, HypothesisUpdate, OpenQuestion, Snapshot, TimelineEvent } from "@/db/schema";

/** Everything Delta already believes about a competitor before a run. */
export type ResearchState = {
  hypotheses: (Hypothesis & { lastUpdate?: HypothesisUpdate })[];
  openQuestions: OpenQuestion[];
  timeline: TimelineEvent[];
  priorFacts: Fact[];
  snapshotsById: Map<number, Snapshot>;
};

export function loadResearchState(db: Db, competitorId: number, excludeRunId?: number): ResearchState {
  const hypotheses = db
    .select()
    .from(schema.hypotheses)
    .where(and(eq(schema.hypotheses.competitorId, competitorId), ne(schema.hypotheses.status, "retired")))
    .orderBy(asc(schema.hypotheses.id))
    .all()
    .map((h) => ({
      ...h,
      lastUpdate: db
        .select()
        .from(schema.hypothesisUpdates)
        .where(eq(schema.hypothesisUpdates.hypothesisId, h.id))
        .orderBy(desc(schema.hypothesisUpdates.id))
        .get(),
    }));

  const openQuestions = db
    .select()
    .from(schema.openQuestions)
    .where(and(eq(schema.openQuestions.competitorId, competitorId), eq(schema.openQuestions.status, "open")))
    .orderBy(asc(schema.openQuestions.id))
    .all();

  const timeline = db
    .select()
    .from(schema.timelineEvents)
    .where(eq(schema.timelineEvents.competitorId, competitorId))
    .orderBy(asc(schema.timelineEvents.eventDate), asc(schema.timelineEvents.id))
    .all();

  const priorFacts = db
    .select()
    .from(schema.facts)
    .where(
      excludeRunId === undefined
        ? eq(schema.facts.competitorId, competitorId)
        : and(eq(schema.facts.competitorId, competitorId), ne(schema.facts.runId, excludeRunId)),
    )
    .orderBy(asc(schema.facts.eventDate), asc(schema.facts.id))
    .all();

  const snapshots = db.select().from(schema.snapshots).where(eq(schema.snapshots.competitorId, competitorId)).all();
  return { hypotheses, openQuestions, timeline, priorFacts, snapshotsById: new Map(snapshots.map((s) => [s.id, s])) };
}

export function factsByIds(db: Db, ids: number[]): Fact[] {
  if (ids.length === 0) return [];
  return db.select().from(schema.facts).where(inArray(schema.facts.id, ids)).all();
}

function src(snapshotsById: Map<number, Snapshot>, snapshotId: number): string {
  const s = snapshotsById.get(snapshotId);
  if (!s) return "";
  return `${s.title || s.url} · ${s.sourceType} · ${s.publishedAt}`;
}

export function formatFact(f: Fact, snapshotsById: Map<number, Snapshot>, full: boolean): string {
  const tag = f.isChange ? " CHANGE" : "";
  const head = `F${f.id} [${f.eventDate ?? "?"}] [${f.category}] [importance ${f.importance}]${tag} ${f.statement}`;
  if (!full) return head;
  return `${head}\n    quote: "${f.quote}"\n    source: ${src(snapshotsById, f.snapshotId)}`;
}

/** Render the prior state with stable ids (F, H, Q, E) the model can cite. */
export function formatResearchState(state: ResearchState): string {
  const out: string[] = [];

  out.push("## Current hypotheses (cite as H<id>)");
  if (state.hypotheses.length === 0) out.push("(none yet — this is the first run)");
  for (const h of state.hypotheses) {
    out.push(`H${h.id} [${h.dimension}] [status ${h.status}] [confidence ${h.confidence.toFixed(2)}] ${h.statement}`);
    if (h.lastUpdate) out.push(`    last update: ${h.lastUpdate.change} — ${h.lastUpdate.reasoning}`);
    if (h.userCorrection && h.correctionAppliedRunId === null) {
      out.push(`    NEW USER CORRECTION (authoritative — you MUST emit an update for H${h.id} this run that honors it and says so in "reasoning"; use "revised" with a corrected statement if the statement is wrong, otherwise "strengthened"/"weakened" with adjusted confidence): ${h.userCorrection}`);
    } else if (h.userCorrection) {
      out.push(`    USER CORRECTION (authoritative, already reflected above): ${h.userCorrection}`);
    }
  }

  out.push("", "## Open research questions raised earlier (cite as Q<id>)");
  if (state.openQuestions.length === 0) out.push("(none)");
  for (const q of state.openQuestions) out.push(`Q${q.id} ${q.question}`);

  out.push("", "## Timeline so far (cite as E<id>)");
  if (state.timeline.length === 0) out.push("(empty)");
  for (const e of state.timeline) out.push(`E${e.id} [${e.eventDate}] ${e.title} — ${e.summary} (facts: ${e.factIds.map((i) => `F${i}`).join(", ") || "none"})`);

  out.push("", "## Facts already known from earlier runs (compact; cite as F<id>)");
  if (state.priorFacts.length === 0) out.push("(none)");
  for (const f of state.priorFacts) out.push(formatFact(f, state.snapshotsById, false));

  return out.join("\n");
}

export function formatNewFacts(newFacts: Fact[], snapshotsById: Map<number, Snapshot>): string {
  if (newFacts.length === 0) return "(no new facts this run)";
  const bySnapshot = new Map<number, Fact[]>();
  for (const f of newFacts) bySnapshot.set(f.snapshotId, [...(bySnapshot.get(f.snapshotId) ?? []), f]);
  const out: string[] = [];
  for (const [snapshotId, facts] of bySnapshot) {
    const s = snapshotsById.get(snapshotId);
    out.push(`### ${s?.title || s?.url || `snapshot ${snapshotId}`}`);
    out.push(`url: ${s?.url ?? "?"} · type: ${s?.sourceType ?? "?"} · published/captured: ${s?.publishedAt ?? "?"}${s?.archiveUrl ? " · archived capture" : ""}`);
    for (const f of facts) out.push(formatFact(f, snapshotsById, true));
    out.push("");
  }
  return out.join("\n");
}
