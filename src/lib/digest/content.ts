/**
 * "What changed since the last digest": a pure content model over the record,
 * rendered by the dashboard now and by the email digest in phase 7.
 */
import { and, asc, eq, gt, inArray, lte } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { Company, Competitor, Fact, Hypothesis, HypothesisUpdate, Insight, OpenQuestion, Run, Snapshot } from "@/db/schema";
import { CHANGE_IMPORTANCE_MIN, HYPOTHESIS_MOVE_MIN, TOP_INSIGHT_MIN_SCORE, TOP_INSIGHTS_MAX, UNSCORED_INSIGHT_SCORE } from "./thresholds";

/** ISO datetimes; runs that finished in (since, until] belong to the period. */
export type DigestPeriod = { since: string; until: string };

export type HypothesisMove = { hypothesis: Hypothesis; prev: number | null; next: number; change: HypothesisUpdate["change"]; reasoning: string; update: HypothesisUpdate };
export type ChangeItem = { fact: Fact; snapshot: Snapshot; previousSnapshot: Snapshot | undefined };

export type CompetitorDigest = {
  competitor: Competitor;
  runs: Run[];
  hypothesesMoved: HypothesisMove[];
  topInsights: Insight[];
  /** Insights ranked below the top list. */
  moreInsights: Insight[];
  changes: ChangeItem[];
  questionsResolved: OpenQuestion[];
  questionsRaised: OpenQuestion[];
  conflicts: OpenQuestion[];
  pagesChecked: number;
  pagesChanged: number;
};

export type DigestContent = {
  company: Company | null;
  period: DigestPeriod;
  quiet: boolean;
  competitors: CompetitorDigest[];
};

export const effectiveScore = (i: Pick<Insight, "score">) => i.score ?? UNSCORED_INSIGHT_SCORE;

/** The newest completed run's finish time, or the given fallback; used to build "since the previous run" periods. */
export function periodSincePreviousRun(db: Db, competitorId: number, now = new Date()): DigestPeriod | null {
  const done = db
    .select()
    .from(schema.runs)
    .where(and(eq(schema.runs.competitorId, competitorId), eq(schema.runs.status, "done")))
    .orderBy(asc(schema.runs.id))
    .all()
    .filter((r) => r.finishedAt);
  if (done.length === 0) return null;
  const last = done[done.length - 1];
  const previous = done[done.length - 2];
  return { since: previous?.finishedAt ?? "0000-01-01T00:00:00.000Z", until: last.finishedAt ?? now.toISOString() };
}

function competitorDigest(db: Db, competitor: Competitor, period: DigestPeriod): CompetitorDigest {
  const runs = db
    .select()
    .from(schema.runs)
    .where(and(eq(schema.runs.competitorId, competitor.id), eq(schema.runs.status, "done"), gt(schema.runs.finishedAt, period.since), lte(schema.runs.finishedAt, period.until)))
    .orderBy(asc(schema.runs.id))
    .all();
  const runIds = runs.map((r) => r.id);
  const hypothesesById = new Map(db.select().from(schema.hypotheses).where(eq(schema.hypotheses.competitorId, competitor.id)).all().map((h) => [h.id, h]));
  const snapshots = new Map(db.select().from(schema.snapshots).where(eq(schema.snapshots.competitorId, competitor.id)).all().map((s) => [s.id, s]));

  const updates = runIds.length ? db.select().from(schema.hypothesisUpdates).where(inArray(schema.hypothesisUpdates.runId, runIds)).orderBy(asc(schema.hypothesisUpdates.id)).all() : [];
  const hypothesesMoved: HypothesisMove[] = updates
    .filter((u) => hypothesesById.has(u.hypothesisId))
    .map((u) => ({ hypothesis: hypothesesById.get(u.hypothesisId)!, prev: u.prevConfidence, next: u.newConfidence, change: u.change, reasoning: u.reasoning, update: u }));

  const insights = runIds.length ? db.select().from(schema.insights).where(inArray(schema.insights.runId, runIds)).all() : [];
  const ranked = insights
    .filter((i) => (i.status === "new" || i.status === "acknowledged") && effectiveScore(i) >= TOP_INSIGHT_MIN_SCORE)
    .sort((a, b) => effectiveScore(b) - effectiveScore(a) || a.id - b.id);
  const topInsights = ranked.slice(0, TOP_INSIGHTS_MAX);
  const moreInsights = ranked.slice(TOP_INSIGHTS_MAX);

  const changeFacts = runIds.length ? db.select().from(schema.facts).where(and(inArray(schema.facts.runId, runIds), eq(schema.facts.isChange, true))).orderBy(asc(schema.facts.id)).all() : [];
  const changes: ChangeItem[] = [];
  for (const fact of changeFacts) {
    const snapshot = snapshots.get(fact.snapshotId);
    if (!snapshot) continue;
    const previousSnapshot: Snapshot | undefined = [...snapshots.values()]
      .filter((s) => s.sourceId === snapshot.sourceId && s.id !== snapshot.id && s.publishedAt <= snapshot.publishedAt && s.contentHash !== snapshot.contentHash)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.id - a.id)[0];
    changes.push({ fact, snapshot, previousSnapshot });
  }
  changes.sort((a, b) => a.snapshot.url.localeCompare(b.snapshot.url) || a.fact.id - b.fact.id);

  const questions = db.select().from(schema.openQuestions).where(eq(schema.openQuestions.competitorId, competitor.id)).all();
  const inPeriod = (id: number | null) => id !== null && runIds.includes(id);
  const questionsResolved = questions.filter((q) => q.status === "resolved" && inPeriod(q.resolvedRunId));
  const questionsRaised = questions.filter((q) => inPeriod(q.createdRunId) && q.kind !== "conflict");
  const conflicts = questions.filter((q) => q.kind === "conflict" && inPeriod(q.createdRunId));

  const sources = db.select().from(schema.sources).where(eq(schema.sources.competitorId, competitor.id)).all();
  const within = (ts: string | null) => ts !== null && ts > period.since && ts <= period.until;
  const pagesChecked = sources.filter((s) => within(s.lastCheckedAt)).length;
  const pagesChanged = sources.filter((s) => within(s.lastChangedAt)).length;

  return { competitor, runs, hypothesesMoved, topInsights, moreInsights, changes, questionsResolved, questionsRaised, conflicts, pagesChecked, pagesChanged };
}

export function isQuiet(competitors: CompetitorDigest[]): boolean {
  return !competitors.some(
    (c) =>
      c.topInsights.length > 0 ||
      c.hypothesesMoved.some((m) => m.prev === null || Math.abs(m.next - m.prev) + 1e-9 >= HYPOTHESIS_MOVE_MIN) ||
      c.changes.some((ch) => ch.fact.importance >= CHANGE_IMPORTANCE_MIN),
  );
}

export function buildDigestContent(db: Db, period: DigestPeriod, opts: { competitorIds?: number[] } = {}): DigestContent {
  const company = db.select().from(schema.company).get() ?? null;
  const all = db.select().from(schema.competitors).orderBy(asc(schema.competitors.id)).all();
  const competitors = (opts.competitorIds ? all.filter((c) => opts.competitorIds!.includes(c.id)) : all).map((c) => competitorDigest(db, c, period));
  return { company, period, quiet: isQuiet(competitors), competitors };
}
