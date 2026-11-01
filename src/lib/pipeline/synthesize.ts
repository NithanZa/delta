import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { Fact, Hypothesis, HypothesisUpdate, Insight, OpenQuestion, Run, StrategyProfile, TimelineEvent } from "@/db/schema";
import { callJson, MODELS, type LlmClient, type LlmUsage } from "@/lib/stepfun/client";
import type { CompanyContext } from "./context";
import type { OnEvent } from "./events";
import { InsightsOutput, SynthesisOutput } from "./schemas";
import { loadResearchState, type ResearchState } from "./state";
import { synthesizeSystemPrompt, synthesizeUserPrompt } from "./prompts/synthesize";
import { insightsSystemPrompt, insightsUserPrompt } from "./prompts/insights";

export type SynthesisResult = {
  timelineEvents: TimelineEvent[];
  hypothesisUpdates: HypothesisUpdate[];
  hypotheses: Hypothesis[];
  profile: StrategyProfile;
  questionsResolved: OpenQuestion[];
  questionsNew: OpenQuestion[];
  usage: LlmUsage;
};

function validIds(ids: number[], valid: Set<number>, onEvent: OnEvent, what: string): number[] {
  const ok = ids.filter((i) => valid.has(i));
  const bad = ids.filter((i) => !valid.has(i));
  if (bad.length) onEvent({ stage: "synthesis", level: "warn", message: `Dropped unknown ${what} id(s) ${bad.join(", ")}` });
  return ok;
}

export async function runSynthesis(
  db: Db,
  run: Run,
  ctx: CompanyContext,
  state: ResearchState,
  newFacts: Fact[],
  onEvent: OnEvent,
  client?: LlmClient,
): Promise<SynthesisResult> {
  const res = await callJson({
    task: "synthesize",
    model: MODELS.deep,
    system: synthesizeSystemPrompt(ctx),
    user: synthesizeUserPrompt(run, state, newFacts),
    schema: SynthesisOutput,
    maxTokens: 16_000,
    client,
  });
  const out = res.data;

  const knownFactIds = new Set<number>([...state.priorFacts.map((f) => f.id), ...newFacts.map((f) => f.id)]);
  const activeHyps = new Map(state.hypotheses.map((h) => [h.id, h]));
  const eventIds = new Set(state.timeline.map((e) => e.id));

  // Timeline
  const timelineEvents: TimelineEvent[] = [];
  for (const e of out.timelineEvents) {
    const row = db
      .insert(schema.timelineEvents)
      .values({
        competitorId: run.competitorId,
        runId: run.id,
        eventDate: e.eventDate,
        title: e.title,
        summary: e.summary,
        factIds: validIds(e.factIds, knownFactIds, onEvent, "fact"),
        relatedEventIds: validIds(e.relatedEventIds, eventIds, onEvent, "event"),
      })
      .returning()
      .get();
    eventIds.add(row.id);
    timelineEvents.push(row);
  }

  // Hypotheses
  const hypothesisUpdates: HypothesisUpdate[] = [];
  const touched = new Set<number>();
  const warn = (message: string) => onEvent({ stage: "synthesis", level: "warn", message });
  for (const u of out.hypothesisUpdates) {
    const factIds = validIds(u.factIds, knownFactIds, onEvent, "fact");
    const existing = u.hypothesisId !== null ? activeHyps.get(u.hypothesisId) : undefined;
    const reasoning = u.reasoning || "(no reasoning given)";
    // A model may emit "created" with an existing id, or several updates for one hypothesis; keep state consistent.
    let change = u.change === "created" && existing ? "strengthened" : u.change;
    if (existing && touched.has(existing.id)) {
      warn(`Ignored a second "${change}" update for H${existing.id} in the same run`);
      continue;
    }
    const statementOk = u.statement.trim().length >= 10;

    if (change === "created" || (!existing && u.hypothesisId === null)) {
      if (!statementOk) {
        warn(`Dropped a new hypothesis without a statement`);
        continue;
      }
      const confidence = Number.isFinite(u.confidence) ? u.confidence : 0.5;
      const row = db
        .insert(schema.hypotheses)
        .values({
          competitorId: run.competitorId,
          dimension: u.dimension ?? "next_moves",
          statement: u.statement.trim(),
          confidence,
          status: "active",
          createdRunId: run.id,
          updatedRunId: run.id,
        })
        .returning()
        .get();
      hypothesisUpdates.push(
        db
          .insert(schema.hypothesisUpdates)
          .values({ hypothesisId: row.id, runId: run.id, change: "created", prevConfidence: null, newConfidence: confidence, reasoning, factIds })
          .returning()
          .get(),
      );
      touched.add(row.id);
      continue;
    }

    if (!existing) {
      warn(`Dropped a "${change}" update for unknown hypothesis ${u.hypothesisId}`);
      continue;
    }
    const confidence = Number.isFinite(u.confidence) ? u.confidence : existing.confidence;

    if (change === "revised" && !statementOk) {
      warn(`H${existing.id}: "revised" without a new statement; recorded as "contradicted" instead`);
      change = "contradicted";
    }

    if (change === "revised") {
      db.update(schema.hypotheses).set({ status: "retired", updatedRunId: run.id }).where(eq(schema.hypotheses.id, existing.id)).run();
      hypothesisUpdates.push(
        db
          .insert(schema.hypothesisUpdates)
          .values({ hypothesisId: existing.id, runId: run.id, change: "retired", prevConfidence: existing.confidence, newConfidence: existing.confidence, reasoning: `Superseded by a revised hypothesis. ${reasoning}`, factIds })
          .returning()
          .get(),
      );
      const row = db
        .insert(schema.hypotheses)
        .values({
          competitorId: run.competitorId,
          dimension: u.dimension ?? existing.dimension,
          statement: u.statement.trim(),
          confidence,
          status: "revised",
          createdRunId: run.id,
          updatedRunId: run.id,
          supersedesId: existing.id,
          userCorrection: existing.userCorrection,
        })
        .returning()
        .get();
      hypothesisUpdates.push(
        db
          .insert(schema.hypothesisUpdates)
          .values({ hypothesisId: row.id, runId: run.id, change: "revised", prevConfidence: existing.confidence, newConfidence: confidence, reasoning, factIds })
          .returning()
          .get(),
      );
      touched.add(existing.id);
      touched.add(row.id);
      continue;
    }

    const status = change === "retired" ? "retired" : change;
    db.update(schema.hypotheses).set({ status, confidence, updatedRunId: run.id }).where(eq(schema.hypotheses.id, existing.id)).run();
    hypothesisUpdates.push(
      db
        .insert(schema.hypothesisUpdates)
        .values({ hypothesisId: existing.id, runId: run.id, change, prevConfidence: existing.confidence, newConfidence: confidence, reasoning, factIds })
        .returning()
        .get(),
    );
    touched.add(existing.id);
  }

  // Strategy profile
  const p = out.strategyProfile;
  const clean = (d: { summary: string; confidence: number; factIds: number[] }) => ({
    summary: d.summary,
    confidence: d.confidence,
    factIds: validIds(d.factIds, knownFactIds, onEvent, "fact"),
  });
  const profile = db
    .insert(schema.strategyProfiles)
    .values({
      competitorId: run.competitorId,
      runId: run.id,
      profile: {
        customers: clean(p.customers),
        productDirection: clean(p.productDirection),
        positioning: clean(p.positioning),
        distribution: clean(p.distribution),
        businessModel: clean(p.businessModel),
      },
    })
    .returning()
    .get();

  // Open questions
  const openIds = new Set(state.openQuestions.map((q) => q.id));
  const questionsResolved: OpenQuestion[] = [];
  for (const r of out.openQuestions.resolved) {
    if (!openIds.has(r.id)) {
      onEvent({ stage: "synthesis", level: "warn", message: `Dropped resolution for unknown question ${r.id}` });
      continue;
    }
    questionsResolved.push(
      db
        .update(schema.openQuestions)
        .set({ status: "resolved", resolution: r.resolution, resolvedRunId: run.id })
        .where(and(eq(schema.openQuestions.id, r.id), eq(schema.openQuestions.status, "open")))
        .returning()
        .get()!,
    );
  }
  const questionsNew = out.openQuestions.new.map((q) =>
    db.insert(schema.openQuestions).values({ competitorId: run.competitorId, createdRunId: run.id, question: q.question }).returning().get(),
  );

  const hypotheses = loadResearchState(db, run.competitorId).hypotheses;
  onEvent({
    stage: "synthesis",
    message: `${timelineEvents.length} timeline event(s), ${hypothesisUpdates.length} hypothesis update(s) across ${touched.size} hypothesis(es), ${questionsResolved.length} question(s) resolved, ${questionsNew.length} raised`,
    data: { timelineEvents: timelineEvents.length, hypothesisUpdates: hypothesisUpdates.length, questionsResolved: questionsResolved.length, questionsNew: questionsNew.length },
  });

  return { timelineEvents, hypothesisUpdates, hypotheses, profile, questionsResolved, questionsNew, usage: res.usage };
}

export async function runInsights(
  db: Db,
  run: Run,
  ctx: CompanyContext,
  synthesis: SynthesisResult,
  newFacts: Fact[],
  state: ResearchState,
  onEvent: OnEvent,
  client?: LlmClient,
): Promise<{ insights: Insight[]; usage: LlmUsage }> {
  const res = await callJson({
    task: "generate_insights",
    model: MODELS.deep,
    system: insightsSystemPrompt(ctx),
    user: insightsUserPrompt({
      run,
      hypotheses: synthesis.hypotheses,
      updatesThisRun: synthesis.hypothesisUpdates,
      newEvents: synthesis.timelineEvents,
      newFacts,
      snapshotsById: state.snapshotsById,
    }),
    schema: InsightsOutput,
    maxTokens: 8_000,
    client,
  });

  const knownFactIds = new Set<number>([...state.priorFacts.map((f) => f.id), ...newFacts.map((f) => f.id)]);
  const knownHypIds = new Set(synthesis.hypotheses.map((h) => h.id));
  const insights = res.data.insights.map((i) =>
    db
      .insert(schema.insights)
      .values({
        competitorId: run.competitorId,
        runId: run.id,
        title: i.title,
        whatHappened: i.whatHappened,
        whatItMeans: i.whatItMeans,
        whyItMatters: i.whyItMatters,
        whatToDoNext: i.whatToDoNext,
        severity: i.severity,
        hypothesisIds: validIds(i.hypothesisIds, knownHypIds, onEvent, "hypothesis"),
        factIds: validIds(i.factIds, knownFactIds, onEvent, "fact"),
        actions: i.actions,
      })
      .returning()
      .get(),
  );
  onEvent({ stage: "insights", message: `${insights.length} insight(s) for ${ctx.company.name}`, data: { insights: insights.length } });
  return { insights, usage: res.usage };
}
