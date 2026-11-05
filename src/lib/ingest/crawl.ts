/**
 * Re-fetch watched pages that are due and poll feeds/sitemaps for new pages
 * on the competitor's domain. Snapshots are created only when a page is new
 * or its extracted text changed (content-hash dedupe in insertSnapshotRecord).
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { Feed, FeedKind, Source, SourceType } from "@/db/schema";
import { withUsageScope } from "@/lib/usage";
import { fetchFeed, parseFeed, type FeedItem } from "./feeds";
import { RobotsCache } from "./robots";
import { createSnapshot, FetchError, hashContent, insertSnapshotRecord } from "./snapshot";
import { domainFromWebsite, isOnDomain, sourceTypeForPath } from "./watchlist";

export type CrawlOptions = {
  now?: Date;
  /** Cap on new pages created from feeds per crawl (oldest first). */
  maxNewPages?: number;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  /** Re-check watched pages even when their interval has not elapsed. */
  force?: boolean;
  /** Gap between requests to the same host. */
  delayMs?: number;
  /** Report what would be fetched without fetching. */
  dryRun?: boolean;
  /** Text for pages our fetcher cannot read (JavaScript-only); phase 8 wires Exa's crawler here. */
  fallbackText?: (url: string) => Promise<{ text: string; title: string | null } | null>;
};

export type CrawlResult = {
  /** Watched pages re-fetched. */
  checked: number;
  /** Watched pages whose content changed (new snapshot). */
  changed: number;
  /** Pages created from feeds and sitemaps. */
  newPages: number;
  errors: number;
  feedsChecked: number;
  feedsUnchanged: number;
  skipped: { robots: number; offDomain: number; capped: number };
};

const FIRST_CRAWL_WINDOW_DAYS = 90;
const MAX_SITEMAP_CHILDREN = 5;
const SITEMAP_PATH_FILTER = /\/(blog|resources|changelog|release|customers|case|pricing|plans|product|partners|press|news)/i;

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

function shiftDays(d: Date, days: number): string {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + days);
  return x.toISOString().slice(0, 10);
}

export function isDue(source: Pick<Source, "lastCheckedAt" | "checkIntervalHours">, now: Date): boolean {
  if (!source.lastCheckedAt) return true;
  return new Date(source.lastCheckedAt).getTime() + source.checkIntervalHours * 3_600_000 <= now.getTime();
}

function sourceTypeForFeedItem(kind: FeedKind, url: string): SourceType {
  if (kind === "rss" || kind === "atom") return "blog";
  try {
    return sourceTypeForPath(new URL(url).pathname);
  } catch {
    return "website";
  }
}

export function crawlCompetitor(db: Db, competitorId: number, opts: CrawlOptions = {}): Promise<CrawlResult> {
  return withUsageScope({ competitorId }, () => crawl(db, competitorId, opts));
}

async function crawl(db: Db, competitorId: number, opts: CrawlOptions): Promise<CrawlResult> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const delayMs = opts.delayMs ?? 1000;
  const maxNewPages = opts.maxNewPages ?? 20;
  const robots = new RobotsCache(opts.fetchImpl);
  const result: CrawlResult = { checked: 0, changed: 0, newPages: 0, errors: 0, feedsChecked: 0, feedsUnchanged: 0, skipped: { robots: 0, offDomain: 0, capped: 0 } };

  const competitor = db.select().from(schema.competitors).where(eq(schema.competitors.id, competitorId)).get();
  if (!competitor) throw new Error(`Competitor ${competitorId} not found`);
  const domain = competitor.domain || domainFromWebsite(competitor.website);
  const nowIso = now.toISOString();

  // 1. Watched pages that are due.
  const watched = db
    .select()
    .from(schema.sources)
    .where(and(eq(schema.sources.competitorId, competitorId), eq(schema.sources.watch, true), eq(schema.sources.enabled, true)))
    .all()
    .filter((s) => opts.force || isDue(s, now));
  for (const source of watched) {
    if (opts.dryRun) {
      log(`would check ${source.url} (${source.sourceType}, last checked ${source.lastCheckedAt ?? "never"})`);
      result.checked++;
      continue;
    }
    if (!(await robots.isAllowed(source.url))) {
      result.skipped.robots++;
      db.update(schema.sources).set({ lastCheckedAt: nowIso, lastError: "disallowed by robots.txt" }).where(eq(schema.sources.id, source.id)).run();
      log(`skipped ${source.url}: disallowed by robots.txt`);
      continue;
    }
    result.checked++;
    try {
      const { created, snapshot } = await createSnapshot(db, {
        competitorId,
        url: source.url,
        sourceType: source.sourceType,
        provider: source.provider,
        publishedAt: now.toISOString().slice(0, 10),
        fetchOptions: { fetchImpl: opts.fetchImpl },
      });
      db.update(schema.sources)
        .set({ lastCheckedAt: nowIso, lastError: null, ...(created ? { lastChangedAt: nowIso } : {}) })
        .where(eq(schema.sources.id, source.id))
        .run();
      if (created) {
        result.changed++;
        log(`changed ${source.url} → snapshot S${snapshot.id} (${snapshot.extractedText.length.toLocaleString()} chars)`);
      } else {
        log(`unchanged ${source.url}`);
      }
    } catch (e) {
      const message = e instanceof FetchError ? e.message : (e as Error).message;
      const fallback = e instanceof FetchError && opts.fallbackText && /rendered by JavaScript|HTTP 403|timed out/.test(message) ? await opts.fallbackText(source.url).catch(() => null) : null;
      if (fallback) {
        const { created, snapshot } = insertSnapshotRecord(db, competitorId, {
          url: source.url,
          sourceType: source.sourceType,
          provider: source.provider,
          title: fallback.title ?? source.title,
          publishedAt: now.toISOString().slice(0, 10),
          fetchedAt: nowIso,
          archiveUrl: null,
          rawHtml: "",
          extractedText: fallback.text,
          contentHash: hashContent(fallback.text),
        });
        db.update(schema.sources)
          .set({ lastCheckedAt: nowIso, lastError: null, ...(created ? { lastChangedAt: nowIso } : {}) })
          .where(eq(schema.sources.id, source.id))
          .run();
        if (created) result.changed++;
        log(`${created ? "changed" : "unchanged"} ${source.url} via the search provider's crawler (own fetch failed: ${message.slice(0, 60)}) → S${snapshot.id}`);
      } else {
        result.errors++;
        db.update(schema.sources).set({ lastCheckedAt: nowIso, lastError: message }).where(eq(schema.sources.id, source.id)).run();
        log(`error ${source.url}: ${message}`);
      }
    }
    await sleep(delayMs);
  }

  // 2. Feeds and sitemaps.
  const feeds = db.select().from(schema.feeds).where(and(eq(schema.feeds.competitorId, competitorId), eq(schema.feeds.enabled, true))).all();
  const candidates: { item: FeedItem; feed: Feed; sourceType: SourceType }[] = [];
  const knownUrls = new Set(db.select({ url: schema.sources.url }).from(schema.sources).where(eq(schema.sources.competitorId, competitorId)).all().map((r) => r.url));
  const feedNewest = new Map<number, string | null>();

  for (const feed of feeds) {
    if (opts.dryRun) {
      log(`would poll ${feed.url} (${feed.kind}, last item ${feed.lastItemAt ?? "none"})`);
      result.feedsChecked++;
      continue;
    }
    result.feedsChecked++;
    try {
      const fetched = await fetchFeed(feed, { fetchImpl: opts.fetchImpl });
      if (fetched.status === "unchanged") {
        result.feedsUnchanged++;
        db.update(schema.feeds).set({ lastCheckedAt: nowIso, lastError: null }).where(eq(schema.feeds.id, feed.id)).run();
        log(`feed unchanged (304) ${feed.url}`);
        continue;
      }
      let parsed = parseFeed(fetched.xml);
      let items = parsed.items;
      if (parsed.kind === "sitemap_index") {
        for (const child of parsed.children.slice(0, MAX_SITEMAP_CHILDREN)) {
          await sleep(delayMs);
          try {
            const childFetched = await fetchFeed({ url: child, etag: null, lastModified: null }, { fetchImpl: opts.fetchImpl });
            if (childFetched.status === "ok") items = items.concat(parseFeed(childFetched.xml).items);
          } catch (e) {
            log(`sitemap child failed ${child}: ${(e as Error).message}`);
          }
        }
        parsed = { ...parsed, items };
      }
      const firstCrawl = feed.lastItemAt === null;
      const since = firstCrawl ? shiftDays(now, -FIRST_CRAWL_WINDOW_DAYS) : feed.lastItemAt!;
      let newest: string | null = feed.lastItemAt;
      for (const item of items) {
        if (item.publishedAt && (!newest || item.publishedAt > newest)) newest = item.publishedAt;
        if (!isOnDomain(item.url, domain)) {
          result.skipped.offDomain++;
          continue;
        }
        if ((parsed.kind === "sitemap" || parsed.kind === "sitemap_index") && !SITEMAP_PATH_FILTER.test(new URL(item.url).pathname)) continue;
        const unseen = !knownUrls.has(item.url);
        const recent = item.publishedAt !== null && item.publishedAt > since;
        if (firstCrawl ? recent && unseen : (recent || (unseen && item.publishedAt === null)) && unseen) {
          candidates.push({ item, feed, sourceType: sourceTypeForFeedItem(parsed.kind, item.url) });
        }
      }
      feedNewest.set(feed.id, newest);
      db.update(schema.feeds)
        .set({ lastCheckedAt: nowIso, lastError: null, etag: fetched.etag, lastModified: fetched.lastModified })
        .where(eq(schema.feeds.id, feed.id))
        .run();
      log(`feed ${feed.url}: ${items.length} item(s), ${candidates.filter((c) => c.feed.id === feed.id).length} new since ${since}`);
    } catch (e) {
      result.errors++;
      db.update(schema.feeds).set({ lastCheckedAt: nowIso, lastError: (e as Error).message }).where(eq(schema.feeds.id, feed.id)).run();
      log(`feed error ${feed.url}: ${(e as Error).message}`);
    }
    await sleep(delayMs);
  }

  // Oldest first so a first crawl of a big blog does not flood a run; cap per crawl.
  candidates.sort((a, b) => (a.item.publishedAt ?? "9999").localeCompare(b.item.publishedAt ?? "9999"));
  const seen = new Set<string>();
  const unique = candidates.filter((c) => (seen.has(c.item.url) ? false : (seen.add(c.item.url), true)));
  const toFetch = unique.slice(0, maxNewPages);
  result.skipped.capped = unique.length - toFetch.length;
  for (const c of toFetch) {
    if (!(await robots.isAllowed(c.item.url))) {
      result.skipped.robots++;
      continue;
    }
    try {
      const { created, snapshot } = await createSnapshot(db, {
        competitorId,
        url: c.item.url,
        sourceType: c.sourceType,
        provider: "feed",
        publishedAt: c.item.publishedAt ?? undefined,
        title: c.item.title || undefined,
        fetchOptions: { fetchImpl: opts.fetchImpl },
      });
      knownUrls.add(c.item.url);
      if (created) {
        result.newPages++;
        log(`new page ${c.item.url} (${c.item.publishedAt ?? "undated"}) → S${snapshot.id}`);
      }
    } catch (e) {
      result.errors++;
      log(`error ${c.item.url}: ${(e as Error).message}`);
    }
    await sleep(delayMs);
  }
  // Advance each feed's high-water mark only after its items were processed.
  for (const [feedId, newest] of feedNewest) {
    if (newest) db.update(schema.feeds).set({ lastItemAt: newest }).where(eq(schema.feeds.id, feedId)).run();
  }

  return result;
}
