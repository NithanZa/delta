import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { schema } from "@/db";
import type { Fact, Hypothesis, HypothesisUpdate, Snapshot } from "@/db/schema";
import { nextReplayRun } from "@/lib/pipeline/presets";

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
      return { ...c, runCount: runs.filter((r) => r.status === "done").length, lastRun: runs[0] ?? null, insightCount, snapshotCount };
    });
}

export function getCompetitorBySlug(slug: string) {
  return getDb().select().from(schema.competitors).where(eq(schema.competitors.slug, slug)).get() ?? null;
}

export function listQuestions(competitorId: number) {
  return getDb().select().from(schema.researchQuestions).where(eq(schema.researchQuestions.competitorId, competitorId)).orderBy(asc(schema.researchQuestions.id)).all();
}

export type HypothesisWithHistory = Hypothesis & { history: HypothesisUpdate[]; supersededBy: Hypothesis | null };

export function getCompetitorWorkspace(slug: string) {
  const db = getDb();
  const competitor = getCompetitorBySlug(slug);
  if (!competitor) return null;
  const cid = competitor.id;

  const runs = db.select().from(schema.runs).where(eq(schema.runs.competitorId, cid)).orderBy(desc(schema.runs.id)).all();
  const snapshots = db.select().from(schema.snapshots).where(eq(schema.snapshots.competitorId, cid)).orderBy(asc(schema.snapshots.publishedAt), asc(schema.snapshots.id)).all();
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
  const hypotheses: HypothesisWithHistory[] = allHypotheses.map((h) => ({
    ...h,
    history: updates.filter((u) => u.hypothesisId === h.id),
    supersededBy: allHypotheses.find((o) => o.supersedesId === h.id) ?? null,
  }));

  const profile = db.select().from(schema.strategyProfiles).where(eq(schema.strategyProfiles.competitorId, cid)).orderBy(desc(schema.strategyProfiles.id)).get() ?? null;
  const timeline = db.select().from(schema.timelineEvents).where(eq(schema.timelineEvents.competitorId, cid)).orderBy(asc(schema.timelineEvents.eventDate), asc(schema.timelineEvents.id)).all();
  const insights = db.select().from(schema.insights).where(eq(schema.insights.competitorId, cid)).orderBy(desc(schema.insights.runId), asc(schema.insights.id)).all();
  const questions = db.select().from(schema.openQuestions).where(eq(schema.openQuestions.competitorId, cid)).orderBy(asc(schema.openQuestions.id)).all();

  const fetchedDates = snapshots.map((s) => s.fetchedAt.slice(0, 10)).sort();
  const capturedRange = fetchedDates.length ? { from: fetchedDates[0], to: fetchedDates[fetchedDates.length - 1] } : null;

  return {
    competitor,
    questions: listQuestions(cid),
    runs,
    snapshots,
    facts,
    hypotheses,
    profile,
    timeline,
    insights,
    questions_open: questions.filter((q) => q.status === "open"),
    questions_resolved: questions.filter((q) => q.status === "resolved"),
    nextRun: nextReplayRun(db, cid),
    isRunning: runs.some((r) => r.status === "running" || r.status === "queued"),
    pendingSnapshots: snapshots.filter((s) => s.processedRunId === null).length,
    capturedRange,
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
