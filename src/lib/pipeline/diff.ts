import { normalizeForMatch } from "./verbatim";

const MIN_UNIT_CHARS = 12;

/** Split page text into comparable units: lines, then sentences within long lines. */
export function splitUnits(text: string): string[] {
  const units: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length < MIN_UNIT_CHARS) continue;
    if (trimmed.length <= 200) {
      units.push(trimmed);
      continue;
    }
    for (const s of trimmed.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)) {
      const u = s.trim();
      if (u.length >= MIN_UNIT_CHARS) units.push(u);
    }
  }
  return units;
}

export type UnitDiff = {
  removed: string[];
  added: string[];
  prevUnits: number;
  curUnits: number;
  /** Set when the diff was reduced with focusUnits before being sent to the model. */
  filtered?: boolean;
};

// A digit, a currency symbol, or a commercial term (word-prefix match, so "plans", "limited" and "users" count).
const FOCUS_PATTERN = /\d|[$€£¥]|\b(?:plan|price|pricing|channel|user|seat|agency|team|free|trial|limit|feature|integration|partner)/i;

/** Keep only the units likely to carry a commercial change; used when a diff is too large to send whole. */
export function focusUnits(units: string[]): string[] {
  return units.filter((u) => FOCUS_PATTERN.test(u));
}

/** Units present in only one of the two versions (order preserved, duplicates collapsed). */
export function diffUnits(previous: string, current: string): UnitDiff {
  const prev = splitUnits(previous);
  const cur = splitUnits(current);
  const prevSet = new Set(prev.map(normalizeForMatch));
  const curSet = new Set(cur.map(normalizeForMatch));
  const seen = new Set<string>();
  const removed = prev.filter((u) => {
    const n = normalizeForMatch(u);
    if (curSet.has(n) || seen.has(n)) return false;
    seen.add(n);
    return true;
  });
  seen.clear();
  const added = cur.filter((u) => {
    const n = normalizeForMatch(u);
    if (prevSet.has(n) || seen.has(n)) return false;
    seen.add(n);
    return true;
  });
  return { removed, added, prevUnits: prev.length, curUnits: cur.length };
}
