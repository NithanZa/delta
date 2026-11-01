/** Normalize text for quote matching: lowercase, unify quotes/dashes, collapse whitespace. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/ /g, " ")
    .replace(/[^\p{L}\p{N}$%.,'"\-/ ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SHINGLE = 3;
const MIN_FUZZY_CHARS = 20;
const FUZZY_THRESHOLD = 0.85;

/**
 * True when `quote` appears in `text` verbatim (after normalization), or, for
 * quotes of at least 20 characters, when at least 85% of its 3-word shingles
 * appear in the text. This tolerates whitespace and punctuation noise from
 * extraction while rejecting paraphrases and fabricated passages.
 */
export function quoteIsVerbatim(quote: string, text: string): boolean {
  const q = normalizeForMatch(quote);
  const t = normalizeForMatch(text);
  if (!q) return false;
  if (t.includes(q)) return true;
  if (q.length < MIN_FUZZY_CHARS) return false;

  const words = q.split(" ");
  if (words.length < SHINGLE) return false;
  let hits = 0;
  const total = words.length - SHINGLE + 1;
  for (let i = 0; i < total; i++) {
    if (t.includes(words.slice(i, i + SHINGLE).join(" "))) hits++;
  }
  return hits / total >= FUZZY_THRESHOLD;
}
