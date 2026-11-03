/**
 * Strict mirrors of the lenient schemas in ./schemas.ts, handed to providers
 * with native structured outputs (Anthropic `output_config.format`). They must
 * stay JSON-schema friendly: no `.catch`, `.transform`, `.coerce` or unions of
 * number|string. The lenient schema remains the single normalisation path, so
 * a provider that ignores the wire schema behaves identically.
 */
import { z } from "zod";
import { AVAILABILITIES, BILLING_CADENCES, DIMENSIONS, FACT_CATEGORIES, HYPOTHESIS_CHANGES, HYPOTHESIS_CLAIM_KINDS, SEVERITIES } from "@/db/schema";

export const FactWire = z.object({
  statement: z.string(),
  quote: z.string(),
  category: z.enum(FACT_CATEGORIES),
  /** ISO date YYYY-MM-DD or null when the page gives no date. */
  eventDate: z.string().nullable(),
  /** 1 (minor) to 5 (major). */
  importance: z.number(),
  /** Cadence of a stated price; null when the fact has no price. */
  billingCadence: z.enum(BILLING_CADENCES).nullable(),
  /** Availability of a capability; null when the fact is not about a capability. */
  availability: z.enum(AVAILABILITIES).nullable(),
});

export const ExtractFactsWire = z.object({ facts: z.array(FactWire) });
export const ChangeWire = z.object({ changes: z.array(FactWire) });

export const TimelineEventWire = z.object({
  eventDate: z.string(),
  title: z.string(),
  summary: z.string(),
  factIds: z.array(z.number()),
  relatedEventIds: z.array(z.number()),
});

export const HypothesisUpdateWire = z.object({
  /** Existing hypothesis id, or null for `created`. */
  hypothesisId: z.number().nullable(),
  /** null keeps the existing hypothesis's dimension. */
  dimension: z.enum(DIMENSIONS).nullable(),
  /** Required for created/revised; empty string otherwise. */
  statement: z.string(),
  change: z.enum(HYPOTHESIS_CHANGES),
  /** positive = has/does X; absence = lacks X. */
  claimKind: z.enum(HYPOTHESIS_CLAIM_KINDS),
  /** 0–1. */
  confidence: z.number(),
  reasoning: z.string(),
  factIds: z.array(z.number()),
});

export const ProfileDimensionWire = z.object({
  summary: z.string(),
  confidence: z.number(),
  factIds: z.array(z.number()),
});

export const SynthesisWire = z.object({
  timelineEvents: z.array(TimelineEventWire),
  hypothesisUpdates: z.array(HypothesisUpdateWire),
  strategyProfile: z.object({
    customers: ProfileDimensionWire,
    productDirection: ProfileDimensionWire,
    positioning: ProfileDimensionWire,
    distribution: ProfileDimensionWire,
    businessModel: ProfileDimensionWire,
  }),
  /** Two official sources disagree; cite both fact ids. */
  conflicts: z.array(z.object({ question: z.string(), factIds: z.array(z.number()) })),
  openQuestions: z.object({
    resolved: z.array(z.object({ id: z.number(), resolution: z.string() })),
    new: z.array(z.object({ question: z.string() })),
  }),
});

export const InsightActionWire = z.object({
  type: z.enum(["respond", "investigate"]),
  text: z.string(),
  rationale: z.string(),
});

export const InsightWire = z.object({
  /** Existing insight id this one updates, else null. */
  updatesInsightId: z.number().nullable(),
  /** 1–5. */
  relevance: z.number(),
  relevanceNote: z.string(),
  /** 1–5. */
  actionability: z.number(),
  title: z.string(),
  whatHappened: z.string(),
  whatItMeans: z.string(),
  whyItMatters: z.string(),
  whatToDoNext: z.string(),
  severity: z.enum(SEVERITIES),
  hypothesisIds: z.array(z.number()),
  factIds: z.array(z.number()),
  actions: z.array(InsightActionWire),
});

export const InsightsWire = z.object({ insights: z.array(InsightWire) });
