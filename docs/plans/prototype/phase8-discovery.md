# Delta prototype

## Outcome

Delta finds pages the watchlist cannot: news (the group.one acquisition of SocialPilot was the audit's biggest recall miss), press, partner and affiliate pages, reviews and launch posts. Discovery runs through Exa behind the existing `SearchProvider` interface with date filters so the point-in-time model holds, a cheap relevance gate keeps homonyms and noise out, volume is capped, and **absence checks** turn "no partner program" from a guess into a recorded check. Recall against the golden timeline is measured and improves.

## Step-by-step

1. **Schema** (`drizzle-kit generate --name discovery`): `sources` add `discovery_query` text nullable, `relevance_note` text nullable; new `absence_checks`: `id, competitor_id, topic, queries JSON, urls_checked JSON, result ('found'|'not_found'), snapshot_id nullable, fact_id nullable, checked_at`. Settings: `discovery.enabled` (true), `discovery.maxNewPagesPerRun` (10), `discovery.lookbackDays` (14), `discovery.blockedDomains` (default `["x.com","twitter.com","facebook.com","instagram.com","tiktok.com","pinterest.com","youtube.com","reddit.com"]`).

2. **Exa client** `src/lib/ingest/exa.ts`: `exaSearch(body, { fetchImpl })` and `exaContents(urls, opts)` as thin `fetch` wrappers over the verified API (below), env `EXA_API_KEY`, 30 s timeout, retry 429/5xx twice with backoff, typed results. No SDK, so the request shape stays visible and testable.

3. **SearchProvider** in `src/lib/ingest/providers.ts`: `discover(competitor, { since, until, maxResults })`:
   - Off-domain templates (each a separate call, `numResults: 10`, `excludeDomains: [competitor.domain, ...blocked]`, `startPublishedDate: since`, `endPublishedDate: until`): `"<Name>" (acquires OR acquired OR acquisition OR funding OR investment)` with `category: "news"`; `"<Name>" (launches OR announces OR introduces OR partnership OR integration)` with `category: "news"`; `"<Name>" pricing (change OR increase OR new plan)`; `"<Name>" review agencies` (no category).
   - On-domain pass (`includeDomains: [competitor.domain]`, same dates): `partner program OR affiliate OR reseller`, `enterprise OR custom pricing OR SSO`, `API OR developer OR integrations`, `changelog OR what's new`.
   - Request `contents: { text: { maxCharacters: 20000 } }` so the text is available as a fallback. Dedupe against `sources.url` (normalise: strip `utm_*`, trailing slash, `www.`). Return `SourceCandidate[]` with `publishedAt` from Exa's `publishedDate` and `note` = the query.

4. **Relevance gate** `src/lib/pipeline/relevance.ts`: one `extract`-role call per candidate (title + first 1500 chars) with schema `{ aboutCompetitor: boolean, relevant: boolean, reason: string, sourceType: SourceType }` and a prompt that names the competitor's domain and description, the company's research questions, and the homonym risk ("Buffer the company, not buffer solutions"). Keep only `aboutCompetitor && relevant`; store `reason` in `sources.relevance_note`. Cost is negligible on Haiku.

5. **Snapshotting discovered pages**: try `createSnapshot(db, { url, sourceType, provider: 'discovery', publishedAt })` (our own fetch keeps the snapshot shape identical); on `FetchError` (JS-only page, 403, timeout) fall back to Exa's `text` via `insertSnapshotRecord` with `rawHtml: ''`, `archiveUrl: null`, `contentHash: hashContent(text)`. Respect `discovery.maxNewPagesPerRun`, highest Exa score first. Also use the Exa fallback for watchlist pages that fail with "probably rendered by JavaScript" in phase 4's crawl (`exaContents([url], { maxAgeHours: 0 })`).

6. **Absence checks** `src/lib/pipeline/absence.ts`: topics `partner_program` (partners/affiliate/reseller/agency program), `enterprise_tier`, `public_api`, `sso_saml`, `white_label`, `marketplace`, `free_plan`. Monthly per competitor (part of the discovery job): probe paths (`/partners`, `/partner-program`, `/affiliates`, `/affiliate`, `/resellers`, `/agencies`, `/enterprise`, `/developers`, `/api`, `/security`, `/marketplace`, `/apps`, `/integrations`) and run the on-domain Exa query for the topic. **Found** → snapshot the page (`provider: 'discovery'`, `watch = true`) and record `result = 'found'` with `snapshot_id`; the facts then come from normal extraction. **Not found** → create a check snapshot (`url: 'check://<domain>/<topic>'`, `sourceType: 'other'`, `provider: 'discovery'`, `extractedText` = the human-readable log of queries and URLs probed, `publishedAt` = today) and a fact with `claim_kind = 'absence'`, `quote = ''`, `statement = 'No <topic> page or announcement was found on <domain> or in web search as of <date> (checked: <n> paths, <m> queries)'`, `category` per topic, `importance 3`. Synthesis may now cite it for an absence hypothesis above 0.4 (phase 3 rule). Re-check monthly; a later `found` retires the absence by producing the positive fact and marking the earlier check `superseded` in `absence_checks.result`.

7. **Discovery job** (worker, `schedule.discoveryCron`, before the weekly run): for each competitor, `discover({ since: lastDiscoveryAt - lookbackDays, until: now })`, relevance gate, snapshot, absence checks when due; log counts. CLI `scripts/discover.ts`: `npm run discover -- --competitor <slug> [--since YYYY-MM-DD --until YYYY-MM-DD] [--absence]`.

8. **Recall measurement**: for Buffer and SocialPilot run discovery over quarterly windows from 2023-01-01 to today (`--since/--until` loop) on a fresh seeded DB, run the live run, then `npm run eval:recall`. Target ≥ 5 of the golden events found (the acquisition, Community, API/MCP launches and the partner program are all findable through news or on-domain search). Record in `eval/results/recall-<date>.md`.

9. **UI**: Evidence tab groups snapshots by provider (watchlist, feed, discovery, manual, internal, backfill, seeded) with the discovery query and relevance reason; absence checks appear as "checked for <topic>: not found (date)" cards; Settings has a discovery toggle and caps.

10. **Tests**: `exa.test.ts` (request body shape, retry on 429, error on 400); provider with a fixture response (dedupe, blocked domains, date params); relevance gate with mock; absence check creates the check snapshot + absence fact and the verbatim gate skips it; cap honoured; fallback to Exa text when `fetchImpl` throws `FetchError`.

## API notes (verified 2026-11-02)

**Exa search** — `POST https://api.exa.ai/search`, header `x-api-key: <EXA_API_KEY>` (or `Authorization: Bearer`), JSON body:

| Field | Type / allowed values |
|---|---|
| `query` | string, required |
| `type` | `auto` (default), `lite`, `deep-lite`, `deep` (legacy `instant`, `fast`, `neural`, `keyword` still accepted) |
| `category` | `company`, `publication`, `news`, `personal site`, `financial report`, `people` (note: `company` and `people` ignore `startPublishedDate`/`endPublishedDate`/`excludeDomains`) |
| `numResults` | 1–100, default 10 |
| `includeDomains` / `excludeDomains` | arrays of hostnames (up to 1200) |
| `startPublishedDate` / `endPublishedDate` | ISO 8601 date-time, e.g. `2025-07-01T00:00:00.000Z` |
| `contents` | `{ text: true | { maxCharacters }, highlights?: { query }, summary?: { query } }` (`livecrawl` is deprecated → use `maxAgeHours` on `/contents`) |
| `userLocation` | optional two-letter country code |

Response: `{ requestId, results: [{ id, url, title, publishedDate /* YYYY-MM-DD, estimated */, author, text?, highlights?, summary? }], costDollars }`. `startCrawlDate`/`endCrawlDate` and `includeText`/`excludeText` are deprecated. A 400 means invalid parameters.

**Exa contents** — `POST https://api.exa.ai/contents`, body `{ ids: ["https://…"], text: { maxCharacters: 60000 }, maxAgeHours: 0 }` (`ids` also accepts the key `urls`; `maxAgeHours` `0` forces a fresh crawl, omit to allow cache, `-1` cache only; `livecrawlTimeout` ms, default 10000). Response `{ results: [{ id, url, title, text }], statuses: [{ id, status, source }] }` — check `statuses` for per-URL failures.

Cost note: Exa bills per request and per contents page (`costDollars` in each response); log it into the job log.

## Acceptance criteria

- [x] AC1 (verified live on 2026-11-03 on a copy of the database, recorded in eval/results/rehearsal-2026-11-03-local.md): `npm run discover -- --competitor socialpilot --since 2025-06-01 --until 2025-08-31` finds the group.one acquisition announcement (a snapshot whose text mentions "group.one" and "acquire") with `provider = 'discovery'` and a relevance note.
- [x] AC2: `npm run discover -- --competitor buffer --absence` records a `found` check for `partner_program` pointing at a snapshot of the agency partner page, and for SocialPilot `--absence` records `found` for the affiliate program; a topic with no page produces an absence fact that `npm run eval:gates` exempts from G1.
- [x] AC3 (unit-tested with injected candidates): Discovery never creates more than `discovery.maxNewPagesPerRun` snapshots per competitor per run, none from blocked domains, none with `publishedAt` outside `[since, until]`.
- [x] AC4 (skipped by Nithan: needs EXA_API_KEY for the sweep; phase-2 baseline 8/11 stands): `npm run eval:recall` after the quarterly discovery sweep reports ≥ 5/11 golden events across both competitors (baseline from phase 2 recorded alongside).
- [x] AC5 (unit-tested with a fake Exa contents response): A watchlist page that fails with the JavaScript error gets a snapshot through the Exa contents fallback with `rawHtml = ''`.
- [x] AC6: `npm run check`, `npm test` pass; `drizzle/0008_*.sql` committed.
