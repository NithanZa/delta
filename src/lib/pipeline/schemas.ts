import { z } from "zod";
import { DIMENSIONS, FACT_CATEGORIES, HYPOTHESIS_CHANGES, SEVERITIES } from "@/db/schema";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/)
  .transform((s) => s.slice(0, 10));

export const FactSchema = z.object({
  statement: z.string().min(8),
  quote: z.string().min(8),
  category: z.enum(FACT_CATEGORIES).catch("other"),
  eventDate: isoDate.nullable().catch(null),
  importance: z.coerce.number().int().min(1).max(5).catch(3),
});
export type FactOutput = z.infer<typeof FactSchema>;

export const ExtractFactsOutput = z.object({ facts: z.array(FactSchema) });
export type ExtractFactsOutput = z.infer<typeof ExtractFactsOutput>;

export const ChangeOutput = z.object({ changes: z.array(FactSchema) });
export type ChangeOutput = z.infer<typeof ChangeOutput>;

/** Accepts 12, "12", "F12", "H3" … and returns the numeric ids. */
const toId = (v: unknown): number | null => {
  const n = parseInt(String(v).replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};
const idList = z
  .array(z.union([z.number(), z.string()]))
  .catch([])
  .transform((arr) => arr.map(toId).filter((n): n is number => n !== null));
const idOrNull = z
  .union([z.number(), z.string(), z.null()])
  .catch(null)
  .transform((v) => (v === null || v === "" ? null : toId(v)));

export const TimelineEventOutput = z.object({
  eventDate: isoDate,
  title: z.string().min(3),
  summary: z.string().min(10),
  factIds: idList,
  relatedEventIds: idList,
});

export const HypothesisUpdateOutput = z.object({
  hypothesisId: idOrNull,
  dimension: z.enum(DIMENSIONS).catch("next_moves"),
  statement: z.string().min(10),
  change: z.enum(HYPOTHESIS_CHANGES),
  confidence: z.coerce.number().min(0).max(1),
  reasoning: z.string().min(10),
  factIds: idList,
});

export const ProfileDimensionOutput = z.object({
  summary: z.string(),
  confidence: z.coerce.number().min(0).max(1).catch(0.3),
  factIds: idList,
});

export const SynthesisOutput = z.object({
  timelineEvents: z.array(TimelineEventOutput).default([]),
  hypothesisUpdates: z.array(HypothesisUpdateOutput).default([]),
  strategyProfile: z.object({
    customers: ProfileDimensionOutput,
    productDirection: ProfileDimensionOutput,
    positioning: ProfileDimensionOutput,
    distribution: ProfileDimensionOutput,
    businessModel: ProfileDimensionOutput,
  }),
  openQuestions: z
    .object({
      resolved: z
        .array(z.object({ id: idOrNull, resolution: z.string() }))
        .default([])
        .transform((arr) => arr.filter((r): r is { id: number; resolution: string } => r.id !== null)),
      new: z.array(z.object({ question: z.string().min(10) })).default([]),
    })
    .default({ resolved: [], new: [] }),
});
export type SynthesisOutput = z.infer<typeof SynthesisOutput>;

export const InsightActionOutput = z.object({
  type: z.enum(["respond", "investigate"]).catch("investigate"),
  text: z.string().min(5),
  rationale: z.string().default(""),
});

export const InsightOutput = z.object({
  title: z.string().min(5),
  whatHappened: z.string().min(10),
  whatItMeans: z.string().min(10),
  whyItMatters: z.string().min(10),
  whatToDoNext: z.string().min(10),
  severity: z.enum(SEVERITIES).catch("medium"),
  hypothesisIds: idList,
  factIds: idList,
  actions: z.array(InsightActionOutput).default([]),
});

export const InsightsOutput = z.object({ insights: z.array(InsightOutput) });
export type InsightsOutput = z.infer<typeof InsightsOutput>;
