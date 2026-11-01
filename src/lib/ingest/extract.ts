import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";

export type Extracted = { title: string; text: string; publishedAt: string | null };

const MAX_TEXT_CHARS = 60_000;

/** Normalize a date-ish string to YYYY-MM-DD, or null when unparseable. */
export function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value.trim());
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function findPublishedAt(doc: Document): string | null {
  const metaSelectors = [
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[property="og:published_time"]',
    'meta[name="date"]',
    'meta[name="pubdate"]',
    'meta[name="publish_date"]',
    'meta[itemprop="datePublished"]',
  ];
  for (const sel of metaSelectors) {
    const v = doc.querySelector(sel)?.getAttribute("content");
    const iso = toIsoDate(v);
    if (iso) return iso;
  }
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const json = JSON.parse(script.textContent ?? "");
      const found = findDatePublished(json);
      const iso = toIsoDate(found);
      if (iso) return iso;
    } catch {
      // ignore malformed JSON-LD
    }
  }
  const time = doc.querySelector("time[datetime]")?.getAttribute("datetime");
  return toIsoDate(time);
}

function findDatePublished(node: unknown, depth = 0): string | null {
  if (!node || depth > 4) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findDatePublished(n, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (typeof obj.datePublished === "string") return obj.datePublished;
    for (const key of ["@graph", "mainEntity", "mainEntityOfPage"]) {
      const r = findDatePublished(obj[key], depth + 1);
      if (r) return r;
    }
  }
  return null;
}

export function normalizeWhitespace(s: string): string {
  return s
    .replace(/\r/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Readable text from raw HTML. Falls back to the document body when
 * Readability cannot find an article (pricing pages, landing pages).
 */
export function extractReadable(html: string, url: string): Extracted {
  const virtualConsole = new VirtualConsole(); // silence CSS parse noise from archived pages
  const dom = new JSDOM(html, { url, virtualConsole });
  const doc = dom.window.document;

  const publishedAt = findPublishedAt(doc);
  const docTitle = doc.querySelector("title")?.textContent?.trim() ?? "";

  // Readability mutates the DOM; clone so the fallback path sees the original.
  const article = new Readability(doc.cloneNode(true) as Document, { charThreshold: 200 }).parse();

  let text = article?.textContent ?? "";
  let title = article?.title || docTitle;
  if (normalizeWhitespace(text).length < 500) {
    // Landing/pricing pages: strip scripts/styles/nav and take the body text instead.
    for (const el of Array.from(doc.querySelectorAll("script, style, noscript, svg, nav, footer, header, iframe"))) {
      el.remove();
    }
    text = doc.body?.textContent ?? "";
    title = docTitle || title;
  }

  text = normalizeWhitespace(text).slice(0, MAX_TEXT_CHARS);
  return { title: title.trim(), text, publishedAt: publishedAt ?? toIsoDate(article?.publishedTime) };
}
