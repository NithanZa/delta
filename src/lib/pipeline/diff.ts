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

export type UnitDiff = { removed: string[]; added: string[]; prevUnits: number; curUnits: number };

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
