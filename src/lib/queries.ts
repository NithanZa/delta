import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { schema } from "@/db";
import type { Fact, Hypothesis, HypothesisChange, HypothesisUpdate, Insight, OpenQuestion, Run, Snapshot } from "@/db/schema";
import { HYPOTHESIS_CHANGES } from "@/db/schema";
import { buildDigestContent, periodSincePreviousRun, type DigestContent } from "@/lib/digest/content";
import { nextRun } from "@/lib/pipeline/presets";
import { reactionsFor } from "@/lib/reactions";

export function getCompany() {
  return getDb().select().from(schema.company).get() ?? null;
}

export function listCompetitors() {
  const db = getDb();
  return db
    .select()
    .from(schema.competitors)
    .orderBy(asc(schema.competitors.id))
    .all()
    .map((c) => {
      const runs = db.select().from(schema.runs).where(eq(schema.runs.competitorId, c.id)).orderBy(desc(schema.runs.id)).all();
      const insightCount = db.select({ n: sql<number>`count(*)` }).from(schema.insights).where(eq(schema.insights.competitorId, c.id)).get()?.n ?? 0;
      const snapshotCount = db.select({ n: sql<number>`count(*)` }).from(schema.snapshots).where(eq(schema.snapshots.competitorId, c.id)).get()?.n ?? 0;
      const research = runs.filter((r) => r.kind !== "check");
      return { ...c, runCount: research.filter((r) => r.status === "done").length, lastRun: research[0] ?? null, insightCount, snapshotCount };
    });
}

export function getCompetitorBySlug(slug: string) {
  return getDb().select().from(schema.competitors).where(eq(schema.competitors.slug, slug)).get() ?? null;
}

/** Every known page of a competitor with its watch settings; watched first. */
/** Insights still on record (not superseded or dismissed), highest score first. */
export function listActiveInsights(competitorId: number) {
  return getDb()
    .select()
    .from(schema.insights)
    .where(and(eq(schema.insights.competitorId, competitorId), inArray(schema.insights.status, ["new", "acknowledged"])))
    .all()
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.id - a.id);
}

/** Earlier insights an insight replaced, newest first, following supersedesInsightId. */
export function insightChain(insights: Insight[], head: Insight): Insight[] {
  const byId = new Map(insights.map((i) => [i.id, i]));
  const chain: Insight[] = [];
  let cur = head.supersedesInsightId ? byId.get(head.supersedesInsightId) : undefined;
  while (cur && chain.length < 20) {
    chain.push(cur);
    cur = cur.supersedesInsightId ? byId.get(cur.supersedesInsightId) : undefined;
  }
  return chain;
}

export function listWatchlist(competitorId: number) {
  return getDb().select().from(schema.sources).where(eq(schema.sources.competitorId, competitorId)).orderBy(desc(schema.sources.watch), asc(schema.sources.url)).all();
}

export function listFeeds(competitorId: number) {
  return getDb().select().from(schema.feeds).where(eq(schema.feeds.competitorId, competitorId)).orderBy(asc(schema.feeds.id)).all();
}

export function listQuestions(competitorId: number) {
  return getDb().select().from(schema.researchQuestions).where(eq(schema.researchQuestions.competitorId, competitorId)).orderBy(asc(schema.researchQuestions.id)).all();
}

export type HypothesisWithHistory = Hypothesis & {
  history: HypothesisUpdate[];
  supersededBy: Hypothesis | null;
  /** For absence claims: the latest update cites a fact produced by an explicit absence check. */
  absenceVerified: boolean;
};

export type RunDeltaRow = { update: HypothesisUpdate; hypothesis: HypothesisWithHistory; supersedes: Hypothesis | null };
export type Trajectory = { hypothesis: HypothesisWithHistory; points: { run: Run; confidence: number | null }[] };
export type RunDelta = {
  run: Run;
  rows: RunDeltaRow[];
  counts: Record<HypothesisChange, number>;
  questionsResolved: OpenQuestion[];
  questionsRaised: OpenQuestion[];
  eventsAdded: number;
  insightsWritten: number;
  wallMs: number | null;
  trajectories: Trajectory[];
};

/** Everything the latest completed run changed, derived from rows already loaded for the workspace. */
function buildRunDelta(args: {
  runs: Run[];
  hypotheses: HypothesisWithHistory[];
  updates: HypothesisUpdate[];
  questions: OpenQuestion[];
  eventRunIds: number[];
  insightRunIds: number[];
}): RunDelta | null {
  const done = args.runs.filter((r) => r.status === "done").sort((a, b) => a.id - b.id);
  const run = done[done.length - 1];
  if (!run) return null;
  const byId = new Map(args.hypotheses.map((h) => [h.id, h]));
  const rows: RunDeltaRow[] = args.updates
    .filter((u) => u.runId === run.id)
    .flatMap((u) => {
      const hypothesis = byId.get(u.hypothesisId);
      if (!hypothesis) return [];
      return [{ update: u, hypothesis, supersedes: hypothesis.supersedesId ? (byId.get(hypothesis.supersedesId) ?? null) : null }];
    });
  const counts = Object.fromEntries(HYPOTHESIS_CHANGES.map((c) => [c, 0])) as Record<HypothesisChange, number>;
  for (const r of rows) counts[r.update.change] += 1;

  const started = run.startedAt ? Date.parse(run.startedAt) : NaN;
  const finished = run.finishedAt ? Date.parse(run.finishedAt) : NaN;
  const wallMs = run.stats.wallMs ?? (Number.isFinite(started) && Number.isFinite(finished) ? finished - started : null);

  // Top 3 longest-lived hypotheses: most runs touched, then oldest. Confidence per run carries forward between updates.
  const trajectories: Trajectory[] = [...args.hypotheses]
    .map((h) => ({ h, span: new Set(h.history.map((u) => u.runId)).size }))
    .sort((a, b) => b.span - a.span || a.h.id - b.h.id)
    .slice(0, 3)
    .map(({ h }) => {
      let last: number | null = null;
      const points = done.map((r) => {
        const inRun = h.history.filter((u) => u.runId === r.id);
        if (inRun.length) last = inRun[inRun.length - 1].newConfidence;
        return { run: r, confidence: r.id < h.createdRunId ? null : last };
      });
      return { hypothesis: h, points };
    });

  return {
    run,
    rows,
    counts,
    questionsResolved: args.questions.filter((q) => q.status === "resolved" && q.resolvedRunId === run.id),
    questionsRaised: args.questions.filter((q) => q.createdRunId === run.id),
    eventsAdded: args.eventRunIds.filter((id) => id === run.id).length,
    insightsWritten: args.insightRunIds.filter((id) => id === run.id).length,
    wallMs,
    trajectories,
  };
}

export function getCompetitorWorkspace(slug: string) {
  const db = getDb();
  const competitor = getCompetitorBySlug(slug);
  if (!competitor) return null;
  const cid = competitor.id;

  const runs = db.select().from(schema.runs).where(eq(schema.runs.competitorId, cid)).orderBy(desc(schema.runs.id)).all();
  const snapshots = db.select().from(schema.snapshots).where(eq(schema.snapshots.competitorId, cid)).orderBy(asc(schema.snapshots.publishedAt), asc(schema.snapshots.id)).all();
  const sources = db.select().from(schema.sources).where(eq(schema.sources.competitorId, cid)).all();
  const facts = db.select().from(schema.facts).where(eq(schema.facts.competitorId, cid)).orderBy(asc(schema.facts.id)).all();

  const allHypotheses = db.select().from(schema.hypotheses).where(eq(schema.hypotheses.competitorId, cid)).orderBy(asc(schema.hypotheses.id)).all();
  const updates = allHypotheses.length
    ? db
        .select()
        .from(schema.hypothesisUpdates)
        .where(inArray(schema.hypothesisUpdates.hypothesisId, allHypotheses.map((h) => h.id)))
        .orderBy(asc(schema.hypothesisUpdates.id))
        .all()
    : [];
  const absenceFactIds = new Set(facts.filter((f) => f.claimKind === "absence").map((f) => f.id));
  const hypotheses: HypothesisWithHistory[] = allHypotheses.map((h) => {
    const history = updates.filter((u) => u.hypothesisId === h.id);
    const latest = history[history.length - 1];
    return {
      ...h,
      history,
      supersededBy: allHypotheses.find((o) => o.supersedesId === h.id) ?? null,
      absenceVerified: h.claimKind === "absence" && Boolean(latest?.factIds.some((id) => absenceFactIds.has(id))),
    };
  });

  const profile = db.select().from(schema.strategyProfiles).where(eq(schema.strategyProfiles.competitorId, cid)).orderBy(desc(schema.strategyProfiles.id)).get() ?? null;
  const timeline = db.select().from(schema.timelineEvents).where(eq(schema.timelineEvents.competitorId, cid)).orderBy(asc(schema.timelineEvents.eventDate), asc(schema.timelineEvents.id)).all();
  const insights = db.select().from(schema.insights).where(eq(schema.insights.competitorId, cid)).orderBy(desc(schema.insights.runId), asc(schema.insights.id)).all();
  const questions = db.select().from(schema.openQuestions).where(eq(schema.openQuestions.competitorId, cid)).orderBy(asc(schema.openQuestions.id)).all();

  const reactions = reactionsFor(db, insights.map((i) => i.id));
  const absenceChecks = db.select().from(schema.absenceChecks).where(eq(schema.absenceChecks.competitorId, cid)).orderBy(desc(schema.absenceChecks.id)).all();
  const activeBackfillJob = db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.kind, "backfill"), eq(schema.jobs.competitorId, cid)))
    .orderBy(desc(schema.jobs.id))
    .get();
  const backfilled = snapshots.filter((s) => sources.find((src) => src.id === s.sourceId)?.provider === "backfill").map((s) => s.publishedAt).sort();
  const sincePeriod = periodSincePreviousRun(db, cid);
  const sinceDigest: DigestContent | null = sincePeriod ? buildDigestContent(db, sincePeriod, { competitorIds: [cid] }) : null;
  const publishedDates = snapshots.map((s) => s.publishedAt.slice(0, 10)).sort();
  const capturedRange = publishedDates.length ? { from: publishedDates[0], to: publishedDates[publishedDates.length - 1] } : null;

  return {
    competitor,
    questions: listQuestions(cid),
    runs,
    snapshots,
    sources,
    facts,
    hypotheses,
    profile,
    timeline,
    insights,
    questions_open: questions.filter((q) => q.status === "open"),
    questions_resolved: questions.filter((q) => q.status === "resolved"),
    nextRun: nextRun(db, cid),
    isRunning: runs.some((r) => r.status === "running" || r.status === "queued"),
    pendingSnapshots: snapshots.filter((s) => s.processedRunId === null).length,
    capturedRange,
    sinceDigest,
    reactions,
    absenceChecks,
    activeBackfillJobId: activeBackfillJob && (activeBackfillJob.status === "queued" || activeBackfillJob.status === "running") ? activeBackfillJob.id : null,
    backfilledRange: backfilled.length ? { from: backfilled[0], to: backfilled[backfilled.length - 1] } : null,
    latestRunDelta: buildRunDelta({
      runs,
      hypotheses,
      updates,
      questions,
      eventRunIds: timeline.map((e) => e.runId),
      insightRunIds: insights.map((i) => i.runId),
    }),
  };
}

export type Workspace = NonNullable<ReturnType<typeof getCompetitorWorkspace>>;

export function getRunDetail(runId: number) {
  const db = getDb();
  const run = db.select().from(schema.runs).where(eq(schema.runs.id, runId)).get();
  if (!run) return null;
  const competitor = db.select().from(schema.competitors).where(eq(schema.competitors.id, run.competitorId)).get()!;
  const updates = db.select().from(schema.hypothesisUpdates).where(eq(schema.hypothesisUpdates.runId, runId)).orderBy(asc(schema.hypothesisUpdates.id)).all();
  const hypIds = Array.from(new Set(updates.map((u) => u.hypothesisId)));
  const hypotheses = hypIds.length ? db.select().from(schema.hypotheses).where(inArray(schema.hypotheses.id, hypIds)).all() : [];
  return {
    run,
    competitor,
    updates,
    hypotheses,
    events: db.select().from(schema.timelineEvents).where(eq(schema.timelineEvents.runId, runId)).orderBy(asc(schema.timelineEvents.eventDate)).all(),
    insights: db.select().from(schema.insights).where(eq(schema.insights.runId, runId)).all(),
    facts: db.select().from(schema.facts).where(eq(schema.facts.runId, runId)).orderBy(asc(schema.facts.id)).all(),
    questionsRaised: db.select().from(schema.openQuestions).where(eq(schema.openQuestions.createdRunId, runId)).all(),
    questionsResolved: db.select().from(schema.openQuestions).where(and(eq(schema.openQuestions.resolvedRunId, runId), eq(schema.openQuestions.status, "resolved"))).all(),
    snapshots: db.select().from(schema.snapshots).where(eq(schema.snapshots.processedRunId, runId)).all(),
  };
}

export function factMap(facts: Fact[]): Map<number, Fact> {
  return new Map(facts.map((f) => [f.id, f]));
}

export function snapshotMap(snapshots: Snapshot[]): Map<number, Snapshot> {
  return new Map(snapshots.map((s) => [s.id, s]));
}
