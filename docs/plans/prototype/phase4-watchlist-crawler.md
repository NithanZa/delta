# Delta prototype

## Outcome

Each competitor has a **watchlist** of own-domain pages (pricing, plans, features, home, docs, partners, careers) that Delta re-fetches on an interval, plus **feed and sitemap pollers** that find new pages on the competitor's domain (blog posts, release notes, case studies). `npm run crawl` creates snapshots only when content actually changed or a page is new, respects robots.txt and a polite rate, and records what it checked. Settings shows and edits the watchlist. Four of the five recall misses in the audit were pages on the competitor's own blog or product-update feed; this phase catches them without a search API.

## Step-by-step

1. **Schema** (`drizzle-kit generate --name watchlist`):
   - `PROVIDERS` extended: `seeded | manual_url | search | watchlist | feed | discovery | backfill | internal`.
   - `sources`: add `watch` boolean default false, `enabled` boolean default true, `check_interval_hours` int default 168, `last_checked_at`, `last_changed_at`, `last_error`, `note` text.
   - new `feeds`: `id, competitor_id, url, kind ('rss'|'atom'|'sitemap'|'sitemap_index'), enabled, etag, last_modified, last_checked_at, last_item_at, last_error, created_at` with unique `(competitor_id, url)`.
   - `competitors`: add `domain` text (hostname without `www.`), derived from `website` in `saveCompetitorDetails`/`addCompetitor` and backfilled by migration for existing rows via a one-off script `scripts/backfill-domains.ts`.

2. **Watchlist proposal** `src/lib/ingest/watchlist.ts`: `proposeWatchlist(domain, { fetchImpl })` probes candidate paths `/`, `/pricing`, `/plans`, `/features`, `/product`, `/solutions`, `/customers`, `/case-studies`, `/partners`, `/affiliates`, `/integrations`, `/enterprise`, `/security`, `/changelog`, `/release-notes`, `/whats-new`, `/blog`, `/resources`, `/careers`, `/jobs`, `/docs`, `/help` (GET, follow redirects, keep 200 with ≥ 500 chars of `extractReadable` text, dedupe by final URL). Map path → `sourceType` (pricing/plans → `pricing`; changelog/release-notes/whats-new → `release_notes`; blog/resources → `blog`; customers/case-studies → `customer_story`; careers/jobs → `jobs`; docs/help → `docs`; else `website`). Feed autodiscovery: parse the home page for `<link rel="alternate" type="application/rss+xml|application/atom+xml" href>`, probe `/feed`, `/rss`, `/rss.xml`, `/atom.xml`, `/blog/feed`, `/blog/rss.xml`, `/feed.xml`; sitemaps from `robots.txt` `Sitemap:` lines and `/sitemap.xml`, `/sitemap_index.xml`. Returns `{ pages: [{ url, sourceType, reason }], feeds: [{ url, kind }] }`.

3. **robots.txt** `src/lib/ingest/robots.ts`: fetch once per host per crawl; parse `User-agent` groups for `*` and `DeltaResearchBot`; `Disallow`/`Allow` longest-prefix match; `isAllowed(url)`. Default allow on fetch failure. Unit tests with fixtures.

4. **Feeds** `src/lib/ingest/feeds.ts` with `fast-xml-parser` (API notes). `fetchFeed(feed)` sends `If-None-Match: <etag>` / `If-Modified-Since: <last_modified>` and treats 304 as "no change". `parseFeed(xml)` returns `{ kind, items: [{ url, title, publishedAt }] }` for RSS 2.0 (`rss.channel.item[]`: `link`, `title`, `pubDate`), Atom (`feed.entry[]`: `link[@_rel=alternate][@_href]` or first `link`, `title`, `published ?? updated`), sitemap (`urlset.url[]`: `loc`, `lastmod`), sitemap index (`sitemapindex.sitemap[]`: `loc`, recurse max 5 children). Dates through `toIsoDate()` from `src/lib/ingest/extract.ts`.

5. **Crawl** `src/lib/ingest/crawl.ts`: `crawlCompetitor(db, competitorId, { now, maxNewPages = 20, fetchImpl, log })`:
   - Watched sources whose `last_checked_at + check_interval_hours` is due: `createSnapshot(db, { url, sourceType, provider: source.provider })` (content-hash dedupe already returns `created: false` for unchanged pages). Set `last_checked_at`; set `last_changed_at` when `created`; on `FetchError` store `last_error` and continue.
   - Feeds: new items are those with `publishedAt > last_item_at` or an unseen URL; first crawl considers only items from the last 90 days; keep only URLs on `competitor.domain` or its subdomains; skip robots-disallowed; snapshot with `provider: 'feed'` and `sourceType` from the feed kind (`blog` for RSS/Atom, path mapping for sitemap URLs). Sitemap URLs are considered only when the path matches `/blog|/resources|/changelog|/release|/customers|/case|/pricing|/plans|/product|/partners|/press|/news`.
   - Cap `maxNewPages` per crawl, oldest first, so a first crawl of a big blog does not flood a run. Politeness: one request per host at a time with a 1000 ms gap (`p-limit(1)` per host + delay), user agent `DeltaResearchBot/0.2 (+${DELTA_BASE_URL}/about-bot)`, 20 s timeout. Returns `{ checked, changed, newPages, errors }` and emits log lines.

6. **CLI** `scripts/crawl.ts`: `npm run crawl -- --competitor buffer | --all [--dry-run]`.

7. **Settings UI** (`src/app/settings/page.tsx`, `forms.tsx`, `actions.ts`): per competitor a "Watchlist" table (url, type, watch toggle, interval select 24h/72h/168h, last checked, last change, last error) with server actions `setSourceWatch`, `addWatchSource(url, sourceType)`, `disableSource`; a "Feeds" list with enable toggle and `addFeed`; a "Propose watchlist" button that runs `proposeWatchlist` and renders checkboxes to add. Evidence tab snapshot cards get a "Watch this page" toggle. New page `src/app/about-bot/page.tsx` explaining the crawler and a contact address (linked from the user agent).

8. **Seed.** Add `"watch": true` to pricing/plans/agency/support entries in `data/corpus/*/manifest.json`; `scripts/seed.ts` and `scripts/seed-competitor.ts` set `sources.watch` from it so the demo competitors crawl.

9. **Tests.** Feed parsing fixtures (RSS, Atom, sitemap, sitemap index) → items; conditional-GET 304 path; robots; `proposeWatchlist` with `fetchImpl`; `crawlCompetitor` with `fetchImpl`: unchanged content creates no snapshot but updates `last_checked_at`; changed content creates a snapshot and sets `last_changed_at`; new feed item creates a snapshot with `provider = 'feed'`; off-domain items ignored; cap honoured; disallowed path skipped.

## API notes (verified 2026-11-02)

**fast-xml-parser 5.11.2** (`npm install fast-xml-parser`). From the package's `fxp.d.ts`:

```ts
import { XMLParser } from "fast-xml-parser";
const parser = new XMLParser({
  ignoreAttributes: false,          // default true; we need link@href and rel
  attributeNamePrefix: "@_",        // attributes appear as "@_href"
  isArray: (tagName, jPath, isLeafNode, isAttribute) =>
    ["item", "entry", "url", "sitemap", "link"].includes(tagName), // force arrays
  parseTagValue: false,             // keep "2026-05-27" and ids as strings
  cdataPropName: false,             // inline CDATA into the text value
});
const doc = parser.parse(xmlString);
// RSS: doc.rss.channel.item[]  → { title, link, pubDate }
// Atom: doc.feed.entry[]       → { title, link: [{ "@_href", "@_rel" }], published, updated }
// Sitemap: doc.urlset.url[]    → { loc, lastmod } ; index: doc.sitemapindex.sitemap[] → { loc }
```
Without `isArray`, a feed with a single `item` parses as an object, not a one-element array. Text nodes with attributes become `{ "#text": "...", "@_x": "..." }`. Signature of `ignoreAttributes` also accepts a string/regex list or a function.

**HTTP conditional requests**: send `If-None-Match` with the stored `ETag` and `If-Modified-Since` with the stored `Last-Modified`; a `304 Not Modified` response has no body.

**Sitemap protocol**: `<urlset><url><loc/><lastmod/>` and `<sitemapindex><sitemap><loc/>`; `lastmod` is W3C datetime.

**robots.txt**: group by `User-agent`, longest matching `Allow`/`Disallow` path prefix wins; `Sitemap:` lines are global.

## Acceptance criteria

- [x] AC1: `npm run crawl -- --competitor buffer` on a seeded DB fetches the watched Buffer pages live, creates snapshots only for pages whose extracted text hash differs from the latest stored capture, and prints `{ checked, changed, newPages, errors }`.
- [x] AC2: Adding Buffer's blog feed in Settings and crawling creates at most 20 new snapshots with `provider = 'feed'`, all dated within the last 90 days, none off-domain.
- [x] AC3: A second crawl within the interval checks nothing (`checked = 0`) unless `--force`; a 304 from a feed is logged as unchanged.
- [x] AC4: "Propose watchlist" for `https://www.socialpilot.co` returns the plans/pricing and agencies pages and at least one feed or sitemap.
- [x] AC5: Unit tests cover feeds, robots, proposal and crawl behaviours offline; `npm run check` and `npm test` pass; `drizzle/0004_*.sql` committed.
