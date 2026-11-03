/**
 * RSS 2.0, Atom, sitemap and sitemap-index parsing with fast-xml-parser, plus
 * conditional fetching (ETag / Last-Modified → 304 means "unchanged").
 */
import { XMLParser } from "fast-xml-parser";
import type { Feed, FeedKind } from "@/db/schema";
import { toIsoDate } from "./extract";
import { USER_AGENT } from "./fetchPage";
import { assertPublicHttpUrl } from "./safeUrl";

export type FeedItem = { url: string; title: string; publishedAt: string | null };
export type ParsedFeed = { kind: FeedKind; items: FeedItem[]; /** Child sitemap URLs of a sitemap index. */ children: string[] };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (tagName) => ["item", "entry", "url", "sitemap", "link"].includes(tagName),
  parseTagValue: false,
  cdataPropName: false,
});

type Node = Record<string, unknown> | string | number | undefined | null;

function textOf(node: Node): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node).trim();
  if (Array.isArray(node)) return textOf(node[0] as Node);
  const t = (node as Record<string, unknown>)["#text"];
  return typeof t === "string" || typeof t === "number" ? String(t).trim() : "";
}

function atomLink(links: unknown): string {
  const arr = Array.isArray(links) ? links : links ? [links] : [];
  const objs = arr.map((l) => (typeof l === "object" && l ? (l as Record<string, unknown>) : { "@_href": String(l) }));
  const alternate = objs.find((l) => (l["@_rel"] ?? "alternate") === "alternate" && l["@_href"]);
  return String((alternate ?? objs[0])?.["@_href"] ?? "").trim();
}

export function parseFeed(xml: string): ParsedFeed {
  const doc = parser.parse(xml) as Record<string, Record<string, unknown>>;
  if (doc.rss) {
    const channel = (doc.rss.channel ?? {}) as Record<string, unknown>;
    const items = ((channel.item as unknown[]) ?? []).map((raw) => {
      const it = raw as Record<string, Node>;
      return { url: textOf(it.link), title: textOf(it.title), publishedAt: toIsoDate(textOf(it.pubDate) || textOf(it["dc:date"]) || null) };
    });
    return { kind: "rss", items: items.filter((i) => i.url), children: [] };
  }
  if (doc.feed) {
    const entries = ((doc.feed.entry as unknown[]) ?? []).map((raw) => {
      const e = raw as Record<string, unknown>;
      return { url: atomLink(e.link), title: textOf(e.title as Node), publishedAt: toIsoDate(textOf(e.published as Node) || textOf(e.updated as Node) || null) };
    });
    return { kind: "atom", items: entries.filter((i) => i.url), children: [] };
  }
  if (doc.urlset) {
    const urls = ((doc.urlset.url as unknown[]) ?? []).map((raw) => {
      const u = raw as Record<string, Node>;
      return { url: textOf(u.loc), title: "", publishedAt: toIsoDate(textOf(u.lastmod) || null) };
    });
    return { kind: "sitemap", items: urls.filter((i) => i.url), children: [] };
  }
  if (doc.sitemapindex) {
    const children = ((doc.sitemapindex.sitemap as unknown[]) ?? []).map((raw) => textOf((raw as Record<string, Node>).loc)).filter(Boolean);
    return { kind: "sitemap_index", items: [], children };
  }
  throw new Error("Not an RSS, Atom or sitemap document");
}

/** Guess the kind from the URL when the document has not been fetched yet. */
export function guessFeedKind(url: string): FeedKind {
  const u = url.toLowerCase();
  if (/sitemap[_-]?index/.test(u)) return "sitemap_index";
  if (/sitemap/.test(u)) return "sitemap";
  if (/atom/.test(u)) return "atom";
  return "rss";
}

export type FetchFeedResult = { status: "unchanged" } | { status: "ok"; xml: string; etag: string | null; lastModified: string | null };

export async function fetchFeed(feed: Pick<Feed, "url" | "etag" | "lastModified">, opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<FetchFeedResult> {
  assertPublicHttpUrl(feed.url);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  const headers: Record<string, string> = { "user-agent": USER_AGENT, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" };
  if (feed.etag) headers["if-none-match"] = feed.etag;
  if (feed.lastModified) headers["if-modified-since"] = feed.lastModified;
  try {
    const res = await fetchImpl(feed.url, { headers, redirect: "follow", signal: controller.signal });
    if (res.status === 304) return { status: "unchanged" };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    if (!/<(rss|feed|urlset|sitemapindex)[\s>]/i.test(xml)) throw new Error("response is not an RSS, Atom or sitemap document");
    return { status: "ok", xml, etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified") };
  } catch (e) {
    const reason = (e as Error).name === "AbortError" ? "timed out" : (e as Error).message;
    throw new Error(`Could not fetch feed ${feed.url}: ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}
