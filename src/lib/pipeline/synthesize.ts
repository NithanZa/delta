import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { Fact, Hypothesis, HypothesisClaimKind, HypothesisUpdate, Insight, OpenQuestion, Run, StrategyProfile, TimelineEvent } from "@/db/schema";
import { callJson, type LlmClient, type LlmUsage } from "@/lib/llm/client";
import type { CompanyContext } from "./context";
import type { OnEvent } from "./events";
import { assertPointInTime } from "./guards";
import { evidenceOf, findSupersededInsight, fingerprint, noveltyOf, scoreInsight } from "./rank";
import { InsightsOutput, SynthesisOutput } from "./schemas";
import { InsightsWire, SynthesisWire } from "./wire";
import { loadResearchState, type ResearchState } from "./state";
import { synthesizeSystemPrompt, synthesizeUserPrompt } from "./prompts/synthesize";
import { insightsSystemPrompt, insightsUserPrompt } from "./prompts/insights";

/** An absence claim without an explicit absence check never exceeds this confidence. */
export const ABSENCE_CAP = 0.4;
/** A hypothesis move supported only by internal (partner-supplied) facts is limited to this much. */
export const INTERNAL_MAX_MOVE = 0.1;
/** A hypothesis created from internal facts alone starts no higher than this. */
export const INTERNAL_CREATED_CAP = 0.5;

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
  assertPointInTime(run, state, newFacts);
  const res = await callJson({
    task: "synthesize",
    role: "synthesize",
    wire: SynthesisWire,
    system: synthesizeSystemPrompt(ctx),
    user: synthesizeUserPrompt(run, state, newFacts),
    schema: SynthesisOutput,
    maxTokens: 16_000,
    client,
  });
  const out = res.data;

  const knownFactIds = new Set<number>([...state.priorFacts.map((f) => f.id), ...newFacts.map((f) => f.id)]);
  const absenceFactIds = new Set<number>([...state.priorFacts, ...newFacts].filter((f) => f.claimKind === "absence").map((f) => f.id));
  const internalFactIds = new Set<number>([...state.priorFacts, ...newFacts].filter((f) => f.attribution !== "public").map((f) => f.id));
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
    const claimKind: HypothesisClaimKind = u.claimKind === "absence" || existing?.claimKind === "absence" ? "absence" : "positive";
    // Absence claims need an explicit check behind them; a page not mentioning something proves nothing.
    const internalOnly = factIds.length > 0 && factIds.every((id) => internalFactIds.has(id));
    const capAbsence = (c: number, label: string) => {
      let v = c;
      if (claimKind === "absence" && v > ABSENCE_CAP && !factIds.some((id) => absenceFactIds.has(id))) {
        warn(`${label}: absence claim without an absence check; confidence capped at ${ABSENCE_CAP} (model proposed ${v.toFixed(2)})`);
        v = ABSENCE_CAP;
      }
      // Partner-supplied claims about the competitor are unverified: small moves only.
      if (internalOnly) {
        if (existing) {
          const limited = Math.max(existing.confidence - INTERNAL_MAX_MOVE, Math.min(existing.confidence + INTERNAL_MAX_MOVE, v));
          if (limited !== v) {
            warn(`${label}: cited facts are internal only; move limited to ±${INTERNAL_MAX_MOVE} (model proposed ${v.toFixed(2)}, stored ${limited.toFixed(2)})`);
            v = limited;
          }
        } else if (v > INTERNAL_CREATED_CAP) {
          warn(`${label}: created from internal facts only; confidence capped at ${INTERNAL_CREATED_CAP} (model proposed ${v.toFixed(2)})`);
          v = INTERNAL_CREATED_CAP;
        }
      }
      return v;
    };
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
      const confidence = capAbsence(Number.isFinite(u.confidence) ? u.confidence : 0.5, "new hypothesis");
      const row = db
        .insert(schema.hypotheses)
        .values({
          competitorId: run.competitorId,
          dimension: u.dimension ?? "next_moves",
          statement: u.statement.trim(),
          confidence,
          claimKind,
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
    const confidence = capAbsence(Number.isFinite(u.confidence) ? u.confidence : existing.confidence, `H${existing.id}`);

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
          claimKind,
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

  // Conflicts between official sources become questions that cite both sides; never silently resolved.
  const openConflicts = db
    .select()
    .from(schema.openQuestions)
    .where(and(eq(schema.openQuestions.competitorId, run.competitorId), eq(schema.openQuestions.status, "open"), eq(schema.openQuestions.kind, "conflict")))
    .all();
  const conflictKeys = new Set(openConflicts.map((q) => [...q.factIds].sort((a, b) => a - b).join(",")));
  let conflictsDeduped = 0;
  for (const c of out.conflicts) {
    const ids = validIds(c.factIds, knownFactIds, onEvent, "fact").sort((a, b) => a - b);
    if (ids.length < 2) {
      warn(`Dropped a conflict that does not cite two facts: ${c.question.slice(0, 80)}`);
      continue;
    }
    const key = ids.join(",");
    if (conflictKeys.has(key)) {
      conflictsDeduped++;
      continue;
    }
    conflictKeys.add(key);
    questionsNew.push(
      db.insert(schema.openQuestions).values({ competitorId: run.competitorId, createdRunId: run.id, question: c.question, kind: "conflict", factIds: ids }).returning().get(),
    );
  }
  if (conflictsDeduped) warn(`Ignored ${conflictsDeduped} conflict(s) already open for the same facts`);

  // Corrections acknowledged by an update this run are marked applied; pending ones are reported.
  for (const h of state.hypotheses) {
    if (!h.userCorrection || h.correctionAppliedRunId !== null) continue;
    if (touched.has(h.id)) {
      db.update(schema.hypotheses).set({ correctionAppliedRunId: run.id }).where(eq(schema.hypotheses.id, h.id)).run();
      const replacement = db.select().from(schema.hypotheses).where(eq(schema.hypotheses.supersedesId, h.id)).get();
      if (replacement) db.update(schema.hypotheses).set({ correctionAppliedRunId: run.id }).where(eq(schema.hypotheses.id, replacement.id)).run();
    } else {
      warn(`H${h.id} carries a user correction but the model did not update it; it will be required again next run`);
    }
  }

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
  assertPointInTime(run, state, newFacts);
  // Insights still on record: the model may update one (new evidence) instead of restating it.
  const activeInsights = db
    .select()
    .from(schema.insights)
    .where(and(eq(schema.insights.competitorId, run.competitorId), inArray(schema.insights.status, ["new", "acknowledged"])))
    .all();
  const res = await callJson({
    task: "generate_insights",
    role: "synthesize",
    wire: InsightsWire,
    system: insightsSystemPrompt(ctx),
    user: insightsUserPrompt({
      run,
      hypotheses: synthesis.hypotheses,
      updatesThisRun: synthesis.hypothesisUpdates,
      newEvents: synthesis.timelineEvents,
      newFacts,
      snapshotsById: state.snapshotsById,
      priorInsights: activeInsights,
    }),
    schema: InsightsOutput,
    maxTokens: 8_000,
    client,
  });

  const knownFactIds = new Set<number>([...state.priorFacts.map((f) => f.id), ...newFacts.map((f) => f.id)]);
  const knownHypIds = new Set(synthesis.hypotheses.map((h) => h.id));
  const factsById = new Map([...state.priorFacts, ...newFacts].map((f) => [f.id, f]));
  const hypById = new Map(synthesis.hypotheses.map((h) => [h.id, h]));
  // Largest confidence move per hypothesis this run (a created hypothesis counts as a full move).
  const moves = new Map<number, number>();
  for (const u of synthesis.hypothesisUpdates) moves.set(u.hypothesisId, Math.max(moves.get(u.hypothesisId) ?? 0, u.prevConfidence === null ? 1 : Math.abs(u.newConfidence - u.prevConfidence)));
  const remaining = [...activeInsights];
  let superseded = 0;
  const insights = res.data.insights.map((i) => {
    const hypothesisIds = validIds(i.hypothesisIds, knownHypIds, onEvent, "hypothesis");
    const factIds = validIds(i.factIds, knownFactIds, onEvent, "fact");
    const replaces = findSupersededInsight({ title: i.title, hypothesisIds, updatesInsightId: i.updatesInsightId }, remaining);
    const citedFacts = factIds.map((id) => factsById.get(id)).filter((f): f is Fact => Boolean(f));
    const citedHyps = hypothesisIds.map((id) => hypById.get(id)).filter((h): h is Hypothesis => Boolean(h));
    const novelty = noveltyOf({
      isNew: !replaces,
      citesChange: citedFacts.some((f) => f.isChange),
      maxHypothesisMove: Math.max(0, ...hypothesisIds.map((id) => moves.get(id) ?? 0)),
    });
    const { score, breakdown } = scoreInsight({ relevance: i.relevance, actionability: i.actionability, novelty, evidence: evidenceOf(citedFacts, citedHyps) });
    const row = db
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
        hypothesisIds,
        factIds,
        actions: i.actions,
        score,
        scoreBreakdown: breakdown,
        relevanceNote: i.relevanceNote.trim() || null,
        actionability: i.actionability,
        supersedesInsightId: replaces?.id ?? null,
        fingerprint: fingerprint(hypothesisIds, i.title),
      })
      .returning()
      .get();
    if (replaces) {
      db.update(schema.insights).set({ status: "superseded" }).where(eq(schema.insights.id, replaces.id)).run();
      remaining.splice(remaining.findIndex((r) => r.id === replaces.id), 1);
      superseded++;
      onEvent({ stage: "insights", message: `I${row.id} supersedes I${replaces.id} ("${replaces.title.slice(0, 60)}")` });
    }
    return row;
  });
  onEvent({
    stage: "insights",
    message: `${insights.length} insight(s) for ${ctx.company.name}${superseded ? `, ${superseded} replacing earlier ones` : ""}`,
    data: { insights: insights.length, superseded },
  });
  return { insights, usage: res.usage };
}
