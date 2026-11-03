/**
 * Cheap relevance gate for discovered pages: is this page about *our*
 * competitor (not a homonym) and does it say something a research question cares about?
 */
import { z } from "zod";
import { SOURCE_TYPES } from "@/db/schema";
import { callJson, type LlmClient, type LlmUsage } from "@/lib/llm/client";
import { formatCompanyContext, type CompanyContext } from "./context";

export const CANDIDATE_MARKER = "=== CANDIDATE ===";
const EXCERPT_CHARS = 1500;

export const RelevanceOutput = z.object({
  aboutCompetitor: z.coerce.boolean().catch(false),
  relevant: z.coerce.boolean().catch(false),
  reason: z.string().catch("").default(""),
  sourceType: z.enum(SOURCE_TYPES).catch("other"),
});
export type RelevanceOutput = z.infer<typeof RelevanceOutput>;

export const RelevanceWire = z.object({
  aboutCompetitor: z.boolean(),
  relevant: z.boolean(),
  reason: z.string(),
  sourceType: z.enum(SOURCE_TYPES),
});

export function relevanceSystemPrompt(ctx: CompanyContext, domain: string): string {
  return `You are screening search results for a competitive-intelligence analyst working for ${ctx.company.name}. You decide whether ONE candidate page is about the competitor named "${ctx.competitor.name}" (the company at ${domain || "its own domain"}${ctx.competitor.description ? `: ${ctx.competitor.description}` : ""}) and whether it could matter for the research questions.

${formatCompanyContext(ctx)}

## Rules
- "aboutCompetitor": true only when the page is about THIS company, its products, pricing, partners, customers, people or news. Beware homonyms (a word like "${ctx.competitor.name}" can also be a common noun or another company). A page that merely lists the competitor among many tools is not about it unless it says something specific.
- "relevant": true when the page says something an analyst could use for the research questions: a launch, pricing or packaging change, partnership, acquisition or funding, a review that names strengths or weaknesses, a hiring signal, a customer story. Generic SEO content, job boards reposting listings, coupon sites and scraped directories are not relevant.
- "reason": one sentence naming what the page says and which research question it touches (or why it was rejected).
- "sourceType": one of ${SOURCE_TYPES.filter((t) => t !== "internal").join(", ")}.

Respond with JSON only: {"aboutCompetitor":true|false,"relevant":true|false,"reason":"...","sourceType":"..."}`;
}

export function relevanceUserPrompt(candidate: { url: string; title: string | null; text: string | null; publishedAt?: string | null; query?: string }): string {
  return [
    `URL: ${candidate.url}`,
    `Title: ${candidate.title || "(untitled)"}`,
    candidate.publishedAt ? `Published: ${candidate.publishedAt}` : null,
    candidate.query ? `Found by query: ${candidate.query}` : null,
    "",
    CANDIDATE_MARKER,
    (candidate.text ?? "").slice(0, EXCERPT_CHARS) || "(no text available)",
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

export async function assessRelevance(
  ctx: CompanyContext,
  domain: string,
  candidate: { url: string; title: string | null; text: string | null; publishedAt?: string | null; query?: string },
  client?: LlmClient,
): Promise<{ verdict: RelevanceOutput; usage: LlmUsage }> {
  const res = await callJson({
    task: "assess_relevance",
    role: "extract",
    wire: RelevanceWire,
    system: relevanceSystemPrompt(ctx, domain),
    user: relevanceUserPrompt(candidate),
    schema: RelevanceOutput,
    maxTokens: 1024,
    client,
  });
  return { verdict: res.data, usage: res.usage };
}
