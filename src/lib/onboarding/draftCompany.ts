/**
 * Draft the partner's company profile from its own site, with confidence per
 * field and the clarifying questions only the team can answer.
 */
import { z } from "zod";
import { callJson, type LlmClient, type LlmUsage } from "@/lib/llm/client";
import type { SiteRead } from "./fetchSite";
import { COMPANY_FIELDS, type CompanyField } from "./fields";

export { COMPANY_FIELDS, type CompanyField };

const conf = z.coerce.number().min(0).max(1).catch(0.3);

export const CompanyDraftOutput = z.object({
  name: z.string().min(1),
  description: z.string().catch("").default(""),
  product: z.string().catch("").default(""),
  targetCustomers: z.string().catch("").default(""),
  positioning: z.string().catch("").default(""),
  priorities: z.string().catch("").default(""),
  constraints: z.string().catch("").default(""),
  fieldConfidence: z
    .object({ description: conf, product: conf, targetCustomers: conf, positioning: conf, priorities: conf, constraints: conf })
    .catch({ description: 0.3, product: 0.3, targetCustomers: 0.3, positioning: 0.3, priorities: 0.3, constraints: 0.3 }),
  clarifyingQuestions: z
    .array(z.object({ question: z.string().min(5), whyItMatters: z.string().catch("").default(""), field: z.enum(COMPANY_FIELDS).catch("priorities") }))
    .catch([])
    .transform((qs) => qs.slice(0, 5)),
});
export type CompanyDraft = z.infer<typeof CompanyDraftOutput>;

export const CompanyDraftWire = z.object({
  name: z.string(),
  description: z.string(),
  product: z.string(),
  targetCustomers: z.string(),
  positioning: z.string(),
  priorities: z.string(),
  constraints: z.string(),
  fieldConfidence: z.object({ description: z.number(), product: z.number(), targetCustomers: z.number(), positioning: z.number(), priorities: z.number(), constraints: z.number() }),
  clarifyingQuestions: z.array(z.object({ question: z.string(), whyItMatters: z.string(), field: z.enum(COMPANY_FIELDS) })),
});

export function companyDraftSystemPrompt(): string {
  return `You are Delta, a competitive-intelligence analyst being set up for a new client company. You have read pages from the company's own website. Draft the client profile Delta will use to judge which competitor moves matter.

## Rules
- Draft ONLY what the pages support. Where the site is silent, write a short, explicitly hedged line ("Not stated on the site; likely …") and give that field a low confidence (≤ 0.3).
- "priorities" and "constraints" are hypotheses to confirm with the team, written as such ("Hypothesis: …"). Never invent customer counts, revenue, funding, team size or launch dates that the pages do not state.
- "targetCustomers": who the product is for, in their words, plus what those customers seem to care about.
- "positioning": how the company describes itself against alternatives; name the competitors the site mentions if any.
- "fieldConfidence": 0–1 per field, how well the pages support the text.
- "clarifyingQuestions": 3 to 5 questions that ONLY the team can answer and that change what Delta should watch: team size and engineering capacity, what they will not do, which segment pays, pricing posture, the one competitor move that would hurt most. Each has "whyItMatters" (one sentence) and "field" (which profile field the answer refines: ${COMPANY_FIELDS.join(", ")}).
- Keep every field to 1–4 sentences. Plain prose, no bullet characters.

Respond with JSON only:
{"name":"...","description":"...","product":"...","targetCustomers":"...","positioning":"...","priorities":"...","constraints":"...","fieldConfidence":{"description":0.8,"product":0.7,"targetCustomers":0.6,"positioning":0.5,"priorities":0.3,"constraints":0.2},"clarifyingQuestions":[{"question":"...","whyItMatters":"...","field":"constraints"}]}`;
}

export function siteUserPrompt(site: Pick<SiteRead, "domain" | "website" | "pages">): string {
  const out = [`Website: ${site.website}`, `Domain: ${site.domain}`, `Pages read: ${site.pages.length}`, ""];
  for (const p of site.pages) out.push(`=== PAGE: ${p.url}`, `Title: ${p.title || "(untitled)"}`, p.text, "");
  return out.join("\n");
}

export async function draftCompany(site: SiteRead, client?: LlmClient): Promise<{ draft: CompanyDraft; usage: LlmUsage }> {
  const res = await callJson({ task: "draft_company", role: "synthesize", wire: CompanyDraftWire, system: companyDraftSystemPrompt(), user: siteUserPrompt(site), schema: CompanyDraftOutput, maxTokens: 6000, client });
  return { draft: res.data, usage: res.usage };
}
