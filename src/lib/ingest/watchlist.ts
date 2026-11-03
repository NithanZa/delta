/**
 * Propose a watchlist for a competitor's own domain: probe the usual commercial
 * paths, keep the ones that exist and have real text, map them to source
 * types, and discover feeds and sitemaps.
 */
import pLimit from "p-limit";
import type { FeedKind, SourceType } from "@/db/schema";
import { extractReadable } from "./extract";
import { fetchPage } from "./fetchPage";
import { parseRobots } from "./robots";

export const CANDIDATE_PATHS = [
  "/",
  "/pricing",
  "/plans",
  "/features",
  "/product",
  "/solutions",
  "/solutions/agencies",
  "/agency",
  "/agencies",
  "/for-agencies",
  "/customers",
  "/case-studies",
  "/partners",
  "/affiliates",
  "/integrations",
  "/enterprise",
  "/security",
  "/changelog",
  "/release-notes",
  "/whats-new",
  "/blog",
  "/resources",
  "/careers",
  "/jobs",
  "/docs",
  "/help",
] as const;

const FEED_PATHS = ["/feed", "/rss", "/rss.xml", "/atom.xml", "/blog/feed", "/blog/rss.xml", "/feed.xml", "/resources/feed", "/resources/rss.xml"];
const SITEMAP_PATHS = ["/sitemap.xml", "/sitemap_index.xml"];
const MIN_TEXT_CHARS = 500;

/** Source type implied by a URL path on the competitor's own domain. */
export function sourceTypeForPath(pathname: string): SourceType {
  const p = pathname.toLowerCase();
  if (/^\/(pricing|plans)(\/|$)/.test(p)) return "pricing";
  if (/(changelog|release-notes|releases|whats-new|product-updates)/.test(p)) return "release_notes";
  if (/(customers|case-stud|success-stor)/.test(p)) return "customer_story";
  if (/^\/(blog|resources|articles|news|insights)(\/|$)/.test(p)) return "blog";
  if (/^\/(careers|jobs)(\/|$)/.test(p)) return "jobs";
  if (/^\/(docs|help|support|developers)(\/|$)/.test(p)) return "docs";
  if (/^\/(press|newsroom)(\/|$)/.test(p)) return "press";
  return "website";
}

export type ProposedPage = { url: string; sourceType: SourceType; reason: string; title: string; /** Readable text, when the probe fetched it (onboarding reuses it). */ text?: string };
export type ProposedFeed = { url: string; kind: FeedKind; reason: string };
export type WatchlistProposal = { domain: string; pages: ProposedPage[]; feeds: ProposedFeed[] };

export function domainFromWebsite(website: string): string {
  try {
    return new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function isOnDomain(url: string, domain: string): boolean {
  if (!domain) return false;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

type Opts = { fetchImpl?: typeof fetch; timeoutMs?: number; concurrency?: number };

async function probe(url: string, opts: Opts): Promise<{ finalUrl: string; title: string; text: string } | null> {
  try {
    const page = await fetchPage(url, { fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs ?? 15_000 });
    const extracted = extractReadable(page.html, page.finalUrl);
    if (extracted.text.length < MIN_TEXT_CHARS) return null;
    return { finalUrl: page.finalUrl, title: extracted.title, text: extracted.text };
  } catch {
    return null;
  }
}

async function fetchText(url: string, opts: Opts): Promise<{ ok: boolean; text: string; contentType: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await fetchImpl(url, { redirect: "follow", signal: controller.signal });
    if (!res.ok) return { ok: false, text: "", contentType: "" };
    return { ok: true, text: await res.text(), contentType: res.headers.get("content-type") ?? "" };
  } catch {
    return { ok: false, text: "", contentType: "" };
  } finally {
    clearTimeout(timer);
  }
}

const looksLikeFeed = (text: string) => /<(rss|feed)[\s>]/i.test(text.slice(0, 2000));
const looksLikeSitemap = (text: string) => /<(urlset|sitemapindex)[\s>]/i.test(text.slice(0, 2000));

/** `<link rel="alternate" type="application/rss+xml|atom+xml" href>` tags in a page. */
export function discoverFeedLinks(html: string, baseUrl: string): { url: string; kind: FeedKind }[] {
  const out: { url: string; kind: FeedKind }[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel=["']?[^"'>]*alternate/i.test(tag)) continue;
    const type = /type=["']?([^"'\s>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    if (!/rss|atom/.test(type)) continue;
    const href = /href=["']?([^"'\s>]+)/i.exec(tag)?.[1];
    if (!href) continue;
    try {
      out.push({ url: new URL(href, baseUrl).toString(), kind: type.includes("atom") ? "atom" : "rss" });
    } catch {
      // ignore malformed href
    }
  }
  return out;
}

export async function proposeWatchlist(website: string, opts: Opts = {}): Promise<WatchlistProposal> {
  const domain = domainFromWebsite(website);
  if (!domain) throw new Error(`Not a valid website: ${website}`);
  const base = `https://${new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname}`;
  const limit = pLimit(opts.concurrency ?? 3);

  const pages = new Map<string, ProposedPage>();
  let homeHtml = "";
  await Promise.all(
    CANDIDATE_PATHS.map((path) =>
      limit(async () => {
        const url = `${base}${path}`;
        const hit = await probe(url, opts);
        if (!hit) return;
        if (path === "/") {
          try {
            homeHtml = (await fetchPage(url, { fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs ?? 15_000 })).html;
          } catch {
            homeHtml = "";
          }
        }
        const key = hit.finalUrl.replace(/\/$/, "");
        if (pages.has(key)) return;
        pages.set(key, { url: hit.finalUrl, sourceType: sourceTypeForPath(new URL(hit.finalUrl).pathname), reason: `${path} responded with ${hit.text.length.toLocaleString()} chars`, title: hit.title, text: hit.text });
      }),
    ),
  );

  const feeds = new Map<string, ProposedFeed>();
  const addFeed = (f: ProposedFeed) => {
    if (!feeds.has(f.url)) feeds.set(f.url, f);
  };
  for (const link of discoverFeedLinks(homeHtml, base)) addFeed({ ...link, reason: "linked from the home page" });
  await Promise.all(
    FEED_PATHS.map((path) =>
      limit(async () => {
        const url = `${base}${path}`;
        const res = await fetchText(url, opts);
        if (res.ok && looksLikeFeed(res.text)) addFeed({ url, kind: /<feed[\s>]/i.test(res.text) ? "atom" : "rss", reason: `${path} is a feed` });
      }),
    ),
  );
  const robots = await fetchText(`${base}/robots.txt`, opts);
  const sitemapUrls = new Set<string>([...(robots.ok ? parseRobots(robots.text).sitemaps : []), ...SITEMAP_PATHS.map((p) => `${base}${p}`)]);
  await Promise.all(
    [...sitemapUrls].map((url) =>
      limit(async () => {
        const res = await fetchText(url, opts);
        if (res.ok && looksLikeSitemap(res.text)) addFeed({ url, kind: /<sitemapindex[\s>]/i.test(res.text) ? "sitemap_index" : "sitemap", reason: robots.text.includes(url) ? "listed in robots.txt" : "standard sitemap path" });
      }),
    ),
  );

  return { domain, pages: [...pages.values()], feeds: [...feeds.values()] };
}
