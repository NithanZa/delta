import { FACT_CATEGORIES, type Snapshot } from "@/db/schema";
import { formatCompanyContext, type CompanyContext } from "../context";

export const PAGE_TEXT_MARKER = "=== PAGE TEXT ===";
const MAX_PAGE_CHARS = 40_000;

export function extractFactsSystemPrompt(ctx: CompanyContext): string {
  return `You are a competitive-intelligence analyst working for ${ctx.company.name}. You read one public page published by the competitor ${ctx.competitor.name} and extract OBSERVED FACTS that could matter for the research questions below.

${formatCompanyContext(ctx)}

## Rules
- Observed facts only. Do not infer intent, strategy or motive. "Buffer lists an Agency plan at $120/month" is a fact; "Buffer is targeting agencies" is an inference and must NOT appear.
- Every fact needs a VERBATIM quote copied exactly from the page text (same words, same order; 8–60 words). Do not paraphrase inside "quote". Do not stitch two passages together.
- Prefer specifics: customer segments named, prices and plan names, features and limits, partners, integrations, roles being hired, claims and numbers, changes in messaging.
- Skip navigation, cookie banners, generic marketing fluff, and anything not about the competitor's business.
- 3 to 12 facts per page. Fewer is fine when the page is thin.
- "eventDate": the page's published date (given below) unless the text clearly states a different date for the event itself. Use YYYY-MM-DD or null.
- "category": one of ${FACT_CATEGORIES.join(", ")}.
- "importance": 1 (trivia) to 5 (would change how ${ctx.company.name} competes).

Respond with JSON only: {"facts":[{"statement":"...","quote":"...","category":"...","eventDate":"YYYY-MM-DD"|null,"importance":1-5}]}`;
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
