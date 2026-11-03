import { AVAILABILITIES, BILLING_CADENCES, FACT_CATEGORIES, type Snapshot } from "@/db/schema";
import { formatCompanyContext, type CompanyContext } from "../context";

export const PAGE_TEXT_MARKER = "=== PAGE TEXT ===";
const MAX_PAGE_CHARS = 40_000;

export type ExtractVariant = { internal?: { sender: string } };

export function extractFactsSystemPrompt(ctx: CompanyContext, variant: ExtractVariant = {}): string {
  if (variant.internal) return internalNoteSystemPrompt(ctx, variant.internal.sender);
  return `You are a competitive-intelligence analyst working for ${ctx.company.name}. You read one public page published by the competitor ${ctx.competitor.name} and extract OBSERVED FACTS that could matter for the research questions below.

${formatCompanyContext(ctx)}

## Rules
- Observed facts only. Do not infer intent, strategy or motive. "Buffer lists an Agency plan at $120/month" is a fact; "Buffer is targeting agencies" is an inference and must NOT appear.
- Every fact needs a VERBATIM quote copied exactly from the page text (same words, same order; 8–60 words). Do not paraphrase inside "quote". Do not stitch two passages together.
- Prefer specifics: customer segments named, prices and plan names, features and limits, partners, integrations, roles being hired, claims and numbers, changes in messaging.
- Skip navigation, cookie banners, generic marketing fluff, and anything not about the competitor's business.
- 3 to 12 facts per page. Fewer is fine when the page is thin.
- "eventDate": the page's published date (given below) unless the text clearly states a different date for the event itself. Use YYYY-MM-DD or null.
- "category": one of ${FACT_CATEGORIES.join(", ")}. Affiliate, referral, reseller and partner programs, marketplaces and app directories are "distribution" (use "partnership" only for a named deal between two companies). A commission, payout or revenue share paid to affiliates or partners is a "distribution" fact, not "pricing".
- "importance": 1 (trivia) to 5 (would change how ${ctx.company.name} competes).

## Prices and billing cadence
- Extract EACH listed plan price as its own fact (plan name, price, unit such as per channel or per seat, included quantity, cadence). A page listing three plans yields at least three price facts; never collapse them into one "all plans are billed annually" fact.
- For every price, say what it covers and the billing cadence. Look for "billed yearly", "billed annually", "/year", "per month billed annually", "billed monthly", and toggles like "Monthly | Yearly" near the price.
- If a page shows both a monthly price and an annual-equivalent monthly price for the same plan, extract them as TWO facts: one with "billingCadence": "monthly" and one with "billingCadence": "annual". Never describe the annual-equivalent price as cheaper than the monthly price or as a price cut; it is the same offer on a different cadence.
- "billingCadence": one of ${BILLING_CADENCES.join(", ")} for any fact that states a price ("unknown" when the page does not say); null for facts without a price.

## Availability
- A capability described as "coming soon", "on the roadmap", "next release", "planned", "beta", "early access", "waitlist" or in the future tense is NOT shipped. Set "availability" accordingly and phrase the statement as announced or planned ("lists guest access as a roadmap item"), never as available.
- Use "shipped" only for capabilities the page presents as available now. "deprecated" for capabilities the page says are being retired.
- "availability": one of ${AVAILABILITIES.join(", ")} for facts about a capability, feature, integration or plan; null for facts that are not about a capability.

## Page scope
- A page not mentioning something is not evidence that it does not exist. Never emit a fact that something is absent, missing, unsupported or "not offered" unless the page itself states it in those words (then quote it).

Respond with JSON only: {"facts":[{"statement":"...","quote":"...","category":"...","eventDate":"YYYY-MM-DD"|null,"importance":1-5,"billingCadence":"monthly|annual|one_time|unknown"|null,"availability":"shipped|announced|coming_soon|beta|deprecated|unknown"|null}]}`;
}

/**
 * Internal notes are what the partner's own people told Delta. They are
 * authoritative about the partner and unverified about the competitor; every
 * statement names the sender so synthesis can weigh it accordingly.
 */
function internalNoteSystemPrompt(ctx: CompanyContext, sender: string): string {
  return `You are a competitive-intelligence analyst working for ${ctx.company.name}. You read a NOTE that ${sender}, a person at ${ctx.company.name}, sent to Delta about the competitor ${ctx.competitor.name} (or about ${ctx.company.name} itself). Extract the claims it contains as facts.

${formatCompanyContext(ctx)}

## Rules
- This is internal, unverified intelligence, not a public page. Every "statement" MUST start with "Per ${sender} (internal):" and describe what the note claims, not what is true.
- Every fact needs a VERBATIM quote copied exactly from the note (same words, same order; 5–60 words).
- One fact per distinct claim; 1 to 8 facts. Claims about ${ctx.company.name}'s own customers, pipeline or decisions are facts too (they are authoritative for ${ctx.company.name}).
- "category": one of ${FACT_CATEGORIES.join(", ")}. "importance": 1–5. "eventDate": the note's date (given below) unless the note states another date. "billingCadence" and "availability" as for pages, or null.
- Never emit a fact that something is absent unless the note says so in those words.

Respond with JSON only: {"facts":[{"statement":"Per ${sender} (internal): ...","quote":"...","category":"...","eventDate":"YYYY-MM-DD"|null,"importance":1-5,"billingCadence":"monthly|annual|one_time|unknown"|null,"availability":"shipped|announced|coming_soon|beta|deprecated|unknown"|null}]}`;
}

export function extractFactsUserPrompt(snapshot: Pick<Snapshot, "url" | "sourceType" | "publishedAt" | "title" | "extractedText" | "archiveUrl">): string {
  const header = [
    `URL: ${snapshot.url}`,
    snapshot.archiveUrl ? `Archived capture: ${snapshot.archiveUrl}` : null,
    `Source type: ${snapshot.sourceType}`,
    `Published / captured: ${snapshot.publishedAt}`,
    `Title: ${snapshot.title || "(untitled)"}`,
  ]
    .filter(Boolean)
    .join("\n");
  return `${header}\n\n${PAGE_TEXT_MARKER}\n${snapshot.extractedText.slice(0, MAX_PAGE_CHARS)}`;
}
