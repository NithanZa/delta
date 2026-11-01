import type { Fact, Hypothesis, HypothesisUpdate, Run, Snapshot, TimelineEvent } from "@/db/schema";
import { formatCompanyContext, type CompanyContext } from "../context";
import { formatNewFacts } from "../state";

export function insightsSystemPrompt(ctx: CompanyContext): string {
  const name = ctx.company.name;
  return `You are Delta, a competitive-intelligence analyst working for ${name}. Given what changed in this research run about the competitor ${ctx.competitor.name}, write the insights that matter for ${name} specifically.

## Rules
- Only developments that affect ${name}'s priorities, customers, positioning or roadmap deserve an insight. Skip the rest. 1–5 insights per run; 0 is acceptable if nothing matters.
- Each insight has four clearly separated parts:
  - "whatHappened": observed facts only, with dates. No interpretation.
  - "whatItMeans": the inferred intent or direction, phrased as inference ("this suggests", "likely"), and the uncertainty.
  - "whyItMatters": the consequence for ${name} given its customers, positioning, priorities and constraints.
  - "whatToDoNext": a concrete next step for ${name}.
- "actions": 1–3 items. type "respond" = a product/pricing/positioning/distribution response ${name} could realistically make given its constraints. type "investigate" = a research step BEFORE committing (customer interview questions, a workflow comparison to run, a page to monitor). Prefer "investigate" when the evidence is inferential; include the actual interview questions or comparison criteria in the text.
- Cite the hypothesis ids and fact ids (numbers only) the insight rests on. Never cite ids you were not given.
- "severity": high = affects a stated priority or threatens the core segment; medium = worth a decision this quarter; low = monitor.
- Be concrete and brief. No generic advice ("keep monitoring competitors").

${formatCompanyContext(ctx)}

Respond with JSON only:
{"insights":[{"title":"...","whatHappened":"...","whatItMeans":"...","whyItMatters":"...","whatToDoNext":"...","severity":"high|medium|low","hypothesisIds":[1],"factIds":[2,3],"actions":[{"type":"respond|investigate","text":"...","rationale":"..."}]}]}`;
}

export type InsightsInput = {
  run: Run;
  hypotheses: Hypothesis[];
  updatesThisRun: HypothesisUpdate[];
  newEvents: TimelineEvent[];
  newFacts: Fact[];
  snapshotsById: Map<number, Snapshot>;
};

export function insightsUserPrompt(input: InsightsInput): string {
  const byHyp = new Map<number, HypothesisUpdate>();
  for (const u of input.updatesThisRun) byHyp.set(u.hypothesisId, u);
  const out: string[] = [`# This run: ${input.run.label} (pages dated on or before ${input.run.cutoffDate})`, "", "## Hypotheses after this run (cite as H<id>)"];
  if (input.hypotheses.length === 0) out.push("(none)");
  for (const h of input.hypotheses) {
    const u = byHyp.get(h.id);
    out.push(`H${h.id} [${h.dimension}] [status ${h.status}] [confidence ${h.confidence.toFixed(2)}]${u ? ` [${u.change} this run]` : ""} ${h.statement}`);
    if (u) out.push(`    reasoning: ${u.reasoning}`);
    if (h.supersedesId) out.push(`    (revises H${h.supersedesId})`);
    if (h.userCorrection) out.push(`    user correction: ${h.userCorrection}`);
  }
  out.push("", "## New timeline events this run");
  if (input.newEvents.length === 0) out.push("(none)");
  for (const e of input.newEvents) out.push(`E${e.id} [${e.eventDate}] ${e.title} — ${e.summary}`);
  out.push("", "## New facts this run (cite as F<id>)", formatNewFacts(input.newFacts, input.snapshotsById));
  return out.join("\n");
}
