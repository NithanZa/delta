/**
 * Off-domain discovery: search (Exa) → relevance gate (cheap model call) →
 * snapshot (our own fetch, Exa text as fallback), capped per run.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { LlmClient, LlmUsage } from "@/lib/llm/client";
import { addUsage, emptyUsage } from "@/lib/llm/client";
import { loadCompanyContext } from "@/lib/pipeline/context";
import { assessRelevance } from "@/lib/pipeline/relevance";
import { getSetting } from "@/lib/settings";
import { exaContents, type ExaOptions } from "./exa";
import { SearchProvider, type SourceCandidate } from "./providers";
import { createSnapshot, FetchError, hashContent, insertSnapshotRecord, type SnapshotRecord } from "./snapshot";
import { domainFromWebsite } from "./watchlist";

export type DiscoveryOptions = {
  since: string;
  until: string;
  now?: Date;
  fetchImpl?: typeof fetch;
  /** Exa transport (tests inject a fake fetch here). */
  exa?: ExaOptions;
  client?: LlmClient;
  maxNewPages?: number;
  log?: (m: string) => void;
  /** Skip the search and gate; only used to inject candidates in tests. */
  candidates?: SourceCandidate[];
};

export type DiscoveryResult = {
  searched: number;
  relevant: number;
  rejected: number;
  created: number;
  capped: number;
  errors: number;
  usage: LlmUsage;
  exaCostUsd: number;
};

/** Snapshot from text Exa already fetched (JavaScript-only pages, blocked crawlers). */
export function recordFromText(url: string, candidate: Pick<SourceCandidate, "sourceType" | "title" | "publishedAt" | "text">, now = new Date()): SnapshotRecord {
  const text = (candidate.text ?? "").trim();
  return {
    url,
    sourceType: candidate.sourceType,
    provider: "discovery",
    title: candidate.title ?? url,
    publishedAt: candidate.publishedAt ?? now.toISOString().slice(0, 10),
    fetchedAt: now.toISOString(),
    archiveUrl: null,
    rawHtml: "",
    extractedText: text,
    contentHash: hashContent(text),
  };
}

export async function discoverCompetitor(db: Db, competitorId: number, opts: DiscoveryOptions): Promise<DiscoveryResult> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? new Date();
  const competitor = db.select().from(schema.competitors).where(eq(schema.competitors.id, competitorId)).get();
  if (!competitor) throw new Error(`Competitor ${competitorId} not found`);
  const domain = competitor.domain || domainFromWebsite(competitor.website);
  const ctx = loadCompanyContext(db, competitorId);
  const maxNewPages = opts.maxNewPages ?? getSetting(db, "discovery.maxNewPagesPerRun");
  const result: DiscoveryResult = { searched: 0, relevant: 0, rejected: 0, created: 0, capped: 0, errors: 0, usage: emptyUsage(), exaCostUsd: 0 };

  const knownUrls = db.select({ url: schema.sources.url }).from(schema.sources).where(eq(schema.sources.competitorId, competitorId)).all().map((r) => r.url);
  let candidates = opts.candidates;
  if (!candidates) {
    const provider = new SearchProvider({ ...opts.exa, blockedDomains: getSetting(db, "discovery.blockedDomains"), log });
    candidates = await provider.discover({ slug: competitor.slug, website: competitor.website, name: competitor.name, domain }, { since: opts.since, until: opts.until, knownUrls });
    result.exaCostUsd = provider.costUsd;
  }
  result.searched = candidates.length;
  log(`${candidates.length} candidate(s) from search for ${competitor.name} (${opts.since.slice(0, 10)} → ${opts.until.slice(0, 10)})`);

  const kept: (SourceCandidate & { reason: string })[] = [];
  for (const c of candidates) {
    try {
      const { verdict, usage } = await assessRelevance(ctx, domain, { url: c.url, title: c.title ?? null, text: c.text ?? null, publishedAt: c.publishedAt, query: c.note }, opts.client);
      addUsage(result.usage, usage);
      if (verdict.aboutCompetitor && verdict.relevant) {
        kept.push({ ...c, sourceType: verdict.sourceType === "internal" ? "other" : verdict.sourceType, reason: verdict.reason });
        result.relevant++;
      } else {
        result.rejected++;
        log(`rejected ${c.url}: ${verdict.reason || (verdict.aboutCompetitor ? "not relevant" : "not about the competitor")}`);
      }
    } catch (e) {
      result.errors++;
      log(`relevance check failed for ${c.url}: ${(e as Error).message}`);
    }
  }

  // Highest-ranked first; the cap keeps a noisy week from flooding a run.
  kept.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const toFetch = kept.slice(0, maxNewPages);
  result.capped = kept.length - toFetch.length;
  for (const c of toFetch) {
    try {
      let created: boolean;
      let snapshotId: number;
      try {
        const r = await createSnapshot(db, { competitorId, url: c.url, sourceType: c.sourceType, provider: "discovery", publishedAt: c.publishedAt, title: c.title, fetchOptions: { fetchImpl: opts.fetchImpl } });
        created = r.created;
        snapshotId = r.snapshot.id;
      } catch (e) {
        if (!(e instanceof FetchError) || !(c.text && c.text.trim().length >= 200)) throw e;
        const r = insertSnapshotRecord(db, competitorId, recordFromText(c.url, c, now));
        created = r.created;
        snapshotId = r.snapshot.id;
        log(`fetched ${c.url} through the search provider's text (own fetch failed: ${(e as Error).message.slice(0, 80)})`);
      }
      db.update(schema.sources)
        .set({ discoveryQuery: c.note ?? null, relevanceNote: c.reason })
        .where(and(eq(schema.sources.competitorId, competitorId), eq(schema.sources.url, c.url)))
        .run();
      if (created) {
        result.created++;
        log(`new page ${c.url} (${c.sourceType}, ${c.publishedAt ?? "undated"}) → S${snapshotId}: ${c.reason}`);
      }
    } catch (e) {
      result.errors++;
      log(`could not snapshot ${c.url}: ${(e as Error).message}`);
    }
  }
  log(`discovery done: ${result.created} new page(s), ${result.rejected} rejected, ${result.capped} over the cap, ${result.errors} error(s)`);
  return result;
}

/** Watchlist fallback for pages our fetcher cannot read (JavaScript-only): Exa's crawler text. */
export async function exaTextFallback(url: string, opts: ExaOptions & { now?: Date } = {}): Promise<{ text: string; title: string | null } | null> {
  const res = await exaContents([url], { ...opts, maxAgeHours: 0, task: "page_fallback" });
  const hit = res.results.find((r) => r.url === url || r.id === url) ?? res.results[0];
  if (!hit?.text || hit.text.trim().length < 200) return null;
  return { text: hit.text.trim(), title: hit.title };
}
