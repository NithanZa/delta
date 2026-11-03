import { FACT_CATEGORIES, type Snapshot } from "@/db/schema";
import { formatCompanyContext, type CompanyContext } from "../context";
import type { UnitDiff } from "../diff";

export const REMOVED_MARKER = "=== LINES ONLY IN THE PREVIOUS VERSION (removed) ===";
export const ADDED_MARKER = "=== LINES ONLY IN THE CURRENT VERSION (added) ===";
export const CONTEXT_MARKER = "=== CURRENT VERSION (first part, for context) ===";
// Bounded input keeps the extraction model's reasoning + answer inside its output budget
// (a 12k-per-side diff once overran max_tokens=16384 in the Buffer replay).
const MAX_SIDE_CHARS = 6_000;
const MAX_CONTEXT_CHARS = 1_500;

export function detectChangeSystemPrompt(ctx: CompanyContext): string {
  return `You are a competitive-intelligence analyst working for ${ctx.company.name}. You compare two captures of the SAME page published by ${ctx.competitor.name}, taken on different dates. You are given ONLY the lines that differ between the two captures. Report the meaningful changes.

${formatCompanyContext(ctx)}

## Rules
- A meaningful change is something a customer or competitor would notice: a plan added or removed, a price or limit changed, a feature or integration added/removed, a segment or claim added/removed, messaging that shifts who the product is for.
- IGNORE cosmetic differences: reworded sentences with the same meaning, reordering, live counters ("X people use…", post counts), rotating testimonials, cookie/legal text, dates in footers, navigation, and formatting.
- Most captures differ only cosmetically. It is correct and common to return {"changes":[]}. Report at most 6 changes; never more.
- Before reporting any price decrease or increase, compare the cadence words next to the old and new prices ("billed monthly", "/monthly", "billed yearly", "billed annually", "$X yearly"). If the earlier capture shows monthly-billed prices and the later one shows yearly-billed prices (or vice versa), the numbers are not comparable: do NOT report a price cut or increase. Report only that the page switched the displayed billing cadence, if anything.
- A switch between monthly and annual price display is NOT a price change. If the removed and added lines show the same offer at a different billing cadence (e.g. "$12/mo billed monthly" vs "$10/mo billed yearly"), return no change for it, or a change whose statement says only that the displayed cadence changed. Never say a price was cut, reduced or lowered in that situation.
- A line that disappeared means the page no longer lists it. Say "no longer listed on this page". Do not say removed, discontinued, dropped or shut down unless the page says so; the item may have moved to another page.
- Each change's "statement" must name BOTH the old state and the new state with the dates (e.g. "Between 2024-08-16 and 2025-10-17 the Agency plan ($100/mo for 10 channels) is no longer listed; the page shows only Free, Essentials and Team").
- "billingCadence": monthly | annual | one_time | unknown for a change that states a price, else null. "availability": shipped | announced | coming_soon | beta | deprecated | unknown for a change about a capability, else null.
- Each change needs a VERBATIM "quote" copied exactly from the ADDED lines (for additions/new values) or from the REMOVED lines (for removals). 6–40 words, no paraphrasing, no stitching lines together.
- Keep each statement under 60 words and each quote under 40 words. Be brief: the answer must fit comfortably in the output budget.
- "eventDate": the current capture date. "category": one of ${FACT_CATEGORIES.join(", ")}. "importance": 1–5 (5 = would change how ${ctx.company.name} competes).

Respond with JSON only: {"changes":[{"statement":"...","quote":"...","category":"...","eventDate":"YYYY-MM-DD","importance":1-5,"billingCadence":"monthly|annual|one_time|unknown"|null,"availability":"shipped|announced|coming_soon|beta|deprecated|unknown"|null}]}`;
}

type Side = Pick<Snapshot, "publishedAt" | "extractedText">;

// Signals that sit next to a displayed price (not generic copy such as "save 2 months with yearly billing").
const MONTHLY_SIGNAL = /billed monthly/gi;
const YEARLY_SIGNAL = /billed (?:at )?\$[\d,]+(?:\s+\$[\d,]+)?\s*(?:yearly|annually|\/\s*yr\b|per year)|billed (?:yearly|annually)/gi;

const count = (lines: string[], re: RegExp) => lines.reduce((n, l) => n + (l.match(re)?.length ?? 0), 0);

/** Dominant billing cadence of the prices shown in a set of lines, when one side clearly wins. */
export function dominantCadence(lines: string[]): "monthly" | "yearly" | null {
  const m = count(lines, MONTHLY_SIGNAL);
  const y = count(lines, YEARLY_SIGNAL);
  if (y === 0 && m === 0) return null;
  if (y > 0 && y >= 2 * m) return "yearly";
  if (m > 0 && m >= 2 * y) return "monthly";
  return null;
}

/** Statements that claim a price moved; suppressed when the captures merely switched cadence. */
export const PRICE_MOVE = /\$\s?[\d,]+[^.]*\b(cut|cuts|dropped|drop|dropping|reduced|reduction|lowered|lower|decreased|decrease|fell|cheaper|slashed|raised|rose|increased|increase|hiked|higher)\b|\b(cut|dropped|reduced|lowered|decreased|fell|cheaper|slashed|raised|rose|increased|hiked)\b[^.]*\$\s?[\d,]+/i;

/** A deterministic hint when the two captures display prices on different cadences (the audit's price-cut trap). */
export function cadenceSwitchNote(diff: UnitDiff): string | null {
  const before = dominantCadence(diff.removed);
  const after = dominantCadence(diff.added);
  if (!before || !after || before === after) return null;
  return `NOTE: the removed lines show prices billed ${before} and the added lines show prices billed ${after}. The page switched its displayed billing cadence; price differences between the two captures are NOT price changes and must not be reported as cuts or increases.`;
}

export function detectChangeUserPrompt(url: string, previous: Side, current: Side, diff: UnitDiff): string {
  const note = cadenceSwitchNote(diff);
  return [
    `URL: ${url}`,
    `Previous capture date: ${previous.publishedAt} (${diff.prevUnits} lines)`,
    `Current capture date: ${current.publishedAt} (${diff.curUnits} lines)`,
    ...(note ? [note] : []),
    ...(diff.filtered
      ? ["NOTE: the diff was large, so it was FILTERED to lines that mention a number, a price, or a plan/channel/user/seat/agency/team/free/trial/limit/feature/integration/partner term. Lines without those were dropped before you saw them."]
      : []),
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
