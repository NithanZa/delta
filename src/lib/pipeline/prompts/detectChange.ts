import { FACT_CATEGORIES, type Snapshot } from "@/db/schema";
import { formatCompanyContext, type CompanyContext } from "../context";
import type { UnitDiff } from "../diff";

export const REMOVED_MARKER = "=== LINES ONLY IN THE PREVIOUS VERSION (removed) ===";
export const ADDED_MARKER = "=== LINES ONLY IN THE CURRENT VERSION (added) ===";
export const CONTEXT_MARKER = "=== CURRENT VERSION (first part, for context) ===";
const MAX_SIDE_CHARS = 12_000;
const MAX_CONTEXT_CHARS = 2_000;

export function detectChangeSystemPrompt(ctx: CompanyContext): string {
  return `You are a competitive-intelligence analyst working for ${ctx.company.name}. You compare two captures of the SAME page published by ${ctx.competitor.name}, taken on different dates. You are given ONLY the lines that differ between the two captures. Report the meaningful changes.

${formatCompanyContext(ctx)}

## Rules
- A meaningful change is something a customer or competitor would notice: a plan added or removed, a price or limit changed, a feature or integration added/removed, a segment or claim added/removed, messaging that shifts who the product is for.
- IGNORE cosmetic differences: reworded sentences with the same meaning, reordering, live counters ("X people use…", post counts), rotating testimonials, cookie/legal text, dates in footers, navigation, and formatting.
- Most captures differ only cosmetically. It is correct and common to return {"changes":[]}. Never report more than 6 changes.
- Each change's "statement" must name BOTH the old state and the new state with the dates (e.g. "Between 2024-08-16 and 2025-10-17 the Agency plan ($100/mo for 10 channels) was removed; only Free, Essentials and Team remain").
- Each change needs a VERBATIM "quote" copied exactly from the ADDED lines (for additions/new values) or from the REMOVED lines (for removals). 6–60 words, no paraphrasing, no stitching lines together.
- "eventDate": the current capture date. "category": one of ${FACT_CATEGORIES.join(", ")}. "importance": 1–5 (5 = would change how ${ctx.company.name} competes).

Respond with JSON only: {"changes":[{"statement":"...","quote":"...","category":"...","eventDate":"YYYY-MM-DD","importance":1-5}]}`;
}

type Side = Pick<Snapshot, "publishedAt" | "extractedText">;

export function detectChangeUserPrompt(url: string, previous: Side, current: Side, diff: UnitDiff): string {
  return [
    `URL: ${url}`,
    `Previous capture date: ${previous.publishedAt} (${diff.prevUnits} lines)`,
    `Current capture date: ${current.publishedAt} (${diff.curUnits} lines)`,
    "",
    REMOVED_MARKER,
    diff.removed.join("\n").slice(0, MAX_SIDE_CHARS) || "(none)",
    "",
    ADDED_MARKER,
    diff.added.join("\n").slice(0, MAX_SIDE_CHARS) || "(none)",
    "",
    CONTEXT_MARKER,
    current.extractedText.slice(0, MAX_CONTEXT_CHARS),
  ].join("\n");
}
