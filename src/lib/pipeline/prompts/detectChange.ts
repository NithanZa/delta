import { FACT_CATEGORIES, type Snapshot } from "@/db/schema";
import { formatCompanyContext, type CompanyContext } from "../context";

export const PREVIOUS_MARKER = "=== PREVIOUS VERSION ===";
export const CURRENT_MARKER = "=== CURRENT VERSION ===";
const MAX_SIDE_CHARS = 25_000;

export function detectChangeSystemPrompt(ctx: CompanyContext): string {
  return `You are a competitive-intelligence analyst working for ${ctx.company.name}. You compare two captures of the SAME page published by ${ctx.competitor.name}, taken on different dates, and report only what CHANGED between them.

${formatCompanyContext(ctx)}

## Rules
- Report additions, removals, renames and price changes. Ignore cosmetic edits, reordering, typos, cookie banners and navigation.
- Each change's "statement" must name BOTH the old state and the new state, with the dates (e.g. "Between 2024-08-16 and 2025-10-17 the Agency plan ($100/mo for 10 channels) was removed from the pricing page; only Free, Essentials and Team remain").
- Each change needs a VERBATIM "quote" copied exactly from the CURRENT version when the change is an addition or a new value, or from the PREVIOUS version when something was removed. 8–60 words, no paraphrasing, no stitching.
- If nothing meaningful changed, return {"changes":[]}.
- "eventDate": the date of the current capture (given below). "category": one of ${FACT_CATEGORIES.join(", ")}. "importance": 1–5.

Respond with JSON only: {"changes":[{"statement":"...","quote":"...","category":"...","eventDate":"YYYY-MM-DD","importance":1-5}]}`;
}

type Side = Pick<Snapshot, "publishedAt" | "extractedText">;

export function detectChangeUserPrompt(url: string, previous: Side, current: Side): string {
  return [
    `URL: ${url}`,
    `Previous capture date: ${previous.publishedAt}`,
    `Current capture date: ${current.publishedAt}`,
    "",
    PREVIOUS_MARKER,
    previous.extractedText.slice(0, MAX_SIDE_CHARS),
    "",
    CURRENT_MARKER,
    current.extractedText.slice(0, MAX_SIDE_CHARS),
  ].join("\n");
}
