/**
 * Draft a competitor from its own site: profile with confidences, a watchlist
 * with reasons, feeds, five research questions tuned to the client's
 * priorities, and one question about what to emphasise.
 */
import { z } from "zod";
import type { Company, CompetitorProfile } from "@/db/schema";
import { FEED_KINDS, SOURCE_TYPES } from "@/db/schema";
import { callJson, type LlmClient, type LlmUsage } from "@/lib/llm/client";
import { siteUserPrompt } from "./draftCompany";
import type { SiteRead } from "./fetchSite";

const dim = z.object({ text: z.string().catch("").default(""), confidence: z.coerce.number().min(0).max(1).catch(0.3) });
const emptyDim = { text: "", confidence: 0.2 };

export const CompetitorDraftOutput = z.object({
  name: z.string().min(1),
  description: z.string().catch("").default(""),
  domain: z.string().catch("").default(""),
  profile: z
    .object({ segments: dim, pricingModel: dim, positioning: dim, distribution: dim, notable: dim })
    .catch({ segments: emptyDim, pricingModel: emptyDim, positioning: emptyDim, distribution: emptyDim, notable: emptyDim }),
  suggestedWatchlist: z
    .array(z.object({ url: z.string().url(), sourceType: z.enum(SOURCE_TYPES).catch("website"), reason: z.string().catch("").default(""), watch: z.coerce.boolean().catch(true) }))
    .catch([]),
  feeds: z.array(z.object({ url: z.string().url(), kind: z.enum(FEED_KINDS).catch("rss") })).catch([]),
  researchQuestions: z
    .array(z.string().min(10))
    .catch([])
    .transform((qs) => qs.slice(0, 7)),
  emphasisQuestion: z.string().catch("").default(""),
});
export type CompetitorDraft = z.infer<typeof CompetitorDraftOutput>;

export const CompetitorDraftWire = z.object({
  name: z.string(),
  description: z.string(),
  domain: z.string(),
  profile: z.object({
    segments: z.object({ text: z.string(), confidence: z.number() }),
    pricingModel: z.object({ text: z.string(), confidence: z.number() }),
    positioning: z.object({ text: z.string(), confidence: z.number() }),
    distribution: z.object({ text: z.string(), confidence: z.number() }),
    notable: z.object({ text: z.string(), confidence: z.number() }),
  }),
  suggestedWatchlist: z.array(z.object({ url: z.string(), sourceType: z.enum(SOURCE_TYPES), reason: z.string(), watch: z.boolean() })),
  feeds: z.array(z.object({ url: z.string(), kind: z.enum(FEED_KINDS) })),
  researchQuestions: z.array(z.string()),
  emphasisQuestion: z.string(),
});

export function competitorDraftSystemPrompt(company: Pick<Company, "name" | "description" | "product" | "targetCustomers" | "positioning" | "priorities" | "constraints">): string {
  return `You are Delta, a competitive-intelligence analyst working for ${company.name}. You have read pages from a competitor's website and a list of pages a crawler found there. Draft what Delta should know and watch about this competitor.

## Our company
Description: ${company.description || "(none)"}
Product: ${company.product || "(none)"}
Target customers: ${company.targetCustomers || "(none)"}
Positioning: ${company.positioning || "(none)"}
Priorities: ${company.priorities || "(none)"}
Constraints: ${company.constraints || "(none)"}

## Rules
- "profile": five short entries drafted from the pages only, each with a 0–1 confidence: segments (who they sell to), pricingModel (how they charge, with numbers if shown), positioning (how they describe themselves, against whom), distribution (how they acquire: partners, integrations, content, self-serve), notable (anything else that matters to ${company.name}). Hedge what the site does not say; never invent numbers.
- "suggestedWatchlist": pick from the crawler's list (do not invent URLs): pricing/plans, the product or features page, partner/affiliate/agency pages, changelog or release notes, customers, and the pages most relevant to ${company.name}'s priorities. Each with sourceType (${SOURCE_TYPES.filter((t) => t !== "internal").join(", ")}), a one-line reason, and watch=true for pages that change meaningfully over time (pricing, plans, partners, changelog), false for evergreen pages.
- "feeds": copy the crawler's feed and sitemap URLs that are worth polling (blog RSS/Atom first; a sitemap index only if there is no feed).
- "researchQuestions": exactly 5, each referencing one of ${company.name}'s stated priorities or constraints, covering: segments, pricing/packaging, capabilities, distribution, next moves. Phrase them as questions a weekly run can make progress on.
- "emphasisQuestion": one short question asking the team whether there is an aspect of this competitor they want Delta to watch most closely (give two concrete options drawn from the pages).
- "domain": the competitor's hostname without "www".

Respond with JSON only:
{"name":"...","description":"...","domain":"...","profile":{"segments":{"text":"...","confidence":0.7},"pricingModel":{"text":"...","confidence":0.7},"positioning":{"text":"...","confidence":0.6},"distribution":{"text":"...","confidence":0.5},"notable":{"text":"...","confidence":0.5}},"suggestedWatchlist":[{"url":"https://…","sourceType":"pricing","reason":"...","watch":true}],"feeds":[{"url":"https://…/feed","kind":"rss"}],"researchQuestions":["...","...","...","...","..."],"emphasisQuestion":"..."}`;
}

export function competitorUserPrompt(site: SiteRead): string {
  const out = [siteUserPrompt(site), "=== PAGES FOUND BY THE CRAWLER (choose the watchlist from these) ==="];
  for (const p of site.proposal.pages) out.push(`- ${p.url} [${p.sourceType}] ${p.title || ""} — ${p.reason}`);
  out.push("", "=== FEEDS AND SITEMAPS FOUND ===");
  if (site.proposal.feeds.length === 0) out.push("(none)");
  for (const f of site.proposal.feeds) out.push(`- ${f.url} [${f.kind}] — ${f.reason}`);
  return out.join("\n");
}

export async function draftCompetitor(site: SiteRead, company: Parameters<typeof competitorDraftSystemPrompt>[0], client?: LlmClient): Promise<{ draft: CompetitorDraft; usage: LlmUsage }> {
  const res = await callJson({ task: "draft_competitor", role: "synthesize", wire: CompetitorDraftWire, system: competitorDraftSystemPrompt(company), user: competitorUserPrompt(site), schema: CompetitorDraftOutput, maxTokens: 6000, client });
  const draft = res.data;
  // The watchlist must come from pages the crawler saw; drop anything else.
  const allowed = new Set([...site.proposal.pages.map((p) => p.url.replace(/\/$/, "")), site.website.replace(/\/$/, "")]);
  draft.suggestedWatchlist = draft.suggestedWatchlist.filter((w) => allowed.has(w.url.replace(/\/$/, "")));
  draft.domain = draft.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") || site.domain;
  return { draft, usage: res.usage };
}

export const emptyProfile = (): CompetitorProfile => ({ segments: emptyDim, pricingModel: emptyDim, positioning: emptyDim, distribution: emptyDim, notable: emptyDim });
