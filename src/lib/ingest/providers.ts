import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { Competitor, Provider, SourceType } from "@/db/schema";
import { exaCost, exaSearch, type ExaOptions, type ExaResult } from "./exa";
import { domainFromWebsite, sourceTypeForPath } from "./watchlist";

/** A page a provider proposes for ingestion. */
export type SourceCandidate = {
  url: string;
  sourceType: SourceType;
  provider: Provider;
  publishedAt?: string;
  archiveTimestamp?: string;
  title?: string;
  note?: string;
  /** Page text already fetched by the provider (Exa); used as a fallback when our own fetch fails. */
  text?: string;
  /** Provider ranking, higher first. */
  score?: number;
};

export interface SourceProvider {
  readonly id: Provider;
  discover(competitor: Pick<Competitor, "slug" | "website">): Promise<SourceCandidate[]>;
}

export type ManifestEntry = {
  url: string;
  sourceType: SourceType;
  publishedAt: string;
  archiveTimestamp?: string;
  title?: string;
  note?: string;
  /** Re-fetch this URL on an interval (phase 4 watchlist). */
  watch?: boolean;
};

/** Mark sources as watched when any manifest entry for the URL says `watch: true`. */
export function applyWatchFlags(db: Db, competitorId: number, slug: string): number {
  const urls = new Set(readManifest(slug).filter((e) => e.watch).map((e) => e.url));
  let n = 0;
  for (const url of urls) {
    const res = db
      .update(schema.sources)
      .set({ watch: true })
      .where(and(eq(schema.sources.competitorId, competitorId), eq(schema.sources.url, url)))
      .run();
    n += res.changes;
  }
  return n;
}

export function corpusDir(slug: string): string {
  return path.resolve(process.cwd(), "data", "corpus", slug);
}

export function readManifest(slug: string): ManifestEntry[] {
  const file = path.join(corpusDir(slug), "manifest.json");
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf8")) as ManifestEntry[];
}

/** Curated, dated pages listed in data/corpus/{slug}/manifest.json. */
export class SeededProvider implements SourceProvider {
  readonly id = "seeded" as const;
  async discover(competitor: Pick<Competitor, "slug">): Promise<SourceCandidate[]> {
    return readManifest(competitor.slug).map((e) => ({ ...e, provider: "seeded" as const }));
  }
}

/** A single URL the user pasted in. */
export class ManualUrlProvider implements SourceProvider {
  readonly id = "manual_url" as const;
  constructor(
    private readonly url: string,
    private readonly sourceType: SourceType,
  ) {}
  async discover(): Promise<SourceCandidate[]> {
    return [{ url: this.url, sourceType: this.sourceType, provider: "manual_url" }];
  }
}

/** Strip tracking parameters, fragments, "www." and trailing slashes so the same page is seen once. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$|source$)/i.test(key)) u.searchParams.delete(key);
    u.hostname = u.hostname.replace(/^www\./, "").toLowerCase();
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return url;
  }
}

export type DiscoverWindow = { since: string; until: string; maxResults?: number; knownUrls?: Iterable<string> };

export type DiscoveryQuery = { query: string; sourceType?: SourceType; scope: "off" | "on" };

/** Plain-language queries, as Exa's search is semantic; dates and domains stay hard filters because point-in-time depends on them. */
export function discoveryQueries(name: string): DiscoveryQuery[] {
  return [
    { query: `${name} acquisition or funding news`, sourceType: "press", scope: "off" },
    { query: `${name} product launch, partnership or integration announcement`, sourceType: "press", scope: "off" },
    { query: `${name} pricing change or new plan`, scope: "off" },
    { query: `${name} review for agencies`, scope: "off" },
    { query: `${name} partner, affiliate or reseller program`, scope: "on" },
    { query: `${name} enterprise or custom pricing and SSO`, scope: "on" },
    { query: `${name} API, developer docs and integrations`, scope: "on" },
    { query: `${name} changelog and what's new`, scope: "on" },
  ];
}

/** Off-domain and on-domain web search through Exa, with date filters so the point-in-time model holds. */
export class SearchProvider implements SourceProvider {
  readonly id = "discovery" as const;
  /** Exa cost of the last `discover` call, USD. */
  costUsd = 0;
  constructor(private readonly opts: ExaOptions & { blockedDomains?: string[]; numResults?: number; log?: (m: string) => void } = {}) {}

  async discover(competitor: Pick<Competitor, "slug" | "website"> & { name?: string; domain?: string }, window?: DiscoverWindow): Promise<SourceCandidate[]> {
    if (!window) throw new Error("SearchProvider.discover needs a { since, until } window");
    const name = competitor.name ?? competitor.slug;
    const domain = competitor.domain || domainFromWebsite(competitor.website);
    const blocked = this.opts.blockedDomains ?? [];
    const toIso = (d: string) => (d.length === 10 ? `${d}T00:00:00.000Z` : d);
    const known = new Set([...(window.knownUrls ?? [])].map(normalizeUrl));
    const seen = new Map<string, SourceCandidate>();
    this.costUsd = 0;
    for (const dq of discoveryQueries(name)) {
      const body = {
        query: dq.query,
        ...(this.opts.numResults ? { numResults: this.opts.numResults } : {}),
        startPublishedDate: toIso(window.since),
        endPublishedDate: toIso(window.until),
        // Full text rather than highlights: the relevance gate reads it and it is the fallback when our own fetch fails.
        contents: { text: { maxCharacters: 20_000 } as const },
        ...(dq.scope === "on" ? { includeDomains: [domain] } : { excludeDomains: [domain, ...blocked].filter(Boolean) }),
      };
      let results: ExaResult[];
      try {
        const res = await exaSearch(body, { ...this.opts, task: "discovery" });
        results = res.results;
        this.costUsd += exaCost(res);
      } catch (e) {
        this.opts.log?.(`exa query failed (${dq.query}): ${(e as Error).message}`);
        continue;
      }
      for (const r of results) {
        const url = normalizeUrl(r.url);
        if (known.has(url) || seen.has(url)) continue;
        let host = "";
        try {
          host = new URL(url).hostname;
        } catch {
          continue;
        }
        if (blocked.some((b) => host === b || host.endsWith(`.${b}`))) continue;
        const publishedAt = r.publishedDate ? r.publishedDate.slice(0, 10) : undefined;
        if (publishedAt && (publishedAt < window.since.slice(0, 10) || publishedAt > window.until.slice(0, 10))) continue;
        seen.set(url, {
          url,
          sourceType: dq.scope === "on" ? sourceTypeForPath(new URL(url).pathname) : (dq.sourceType ?? "other"),
          provider: "discovery",
          publishedAt,
          title: r.title ?? undefined,
          note: dq.query,
          text: r.text,
          score: r.score,
        });
      }
    }
    const list = [...seen.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return window.maxResults ? list.slice(0, window.maxResults) : list;
  }
}
