# Delta MVP

## Outcome

Pages become snapshots through one pipeline regardless of origin. A curated, real, dated corpus for the Buffer scenario exists on disk and can be loaded into the database with `npm run seed` alongside the demo company profile, competitor and research questions. Live "Add URL" fetches reuse the same code path.

## Step-by-step

1. Create `src/lib/ingest/extract.ts`: `extractReadable(html: string, url: string) => { title, text, publishedAt | null }` using `jsdom` + `@mozilla/readability`. Pull `publishedAt` from `article:published_time`, `datePublished` JSON-LD, or `<time datetime>` when present. Normalize whitespace, cap text at 60k chars.
2. Create `src/lib/ingest/fetchPage.ts`: `fetchPage(url, { archiveTimestamp? })`. When `archiveTimestamp` (YYYYMMDDhhmmss) is given, fetch `https://web.archive.org/web/{ts}id_/{url}` (the `id_` flag returns the original HTML without the Wayback toolbar) and record `archiveUrl`. Timeout 20s, follow redirects, custom User-Agent, throws `FetchError` with a readable message on non-2xx or on HTML under 500 chars ("page is mostly JavaScript").
3. Create `src/lib/ingest/snapshot.ts`: `createSnapshot({ competitorId, url, sourceType, provider, publishedAt?, archiveTimestamp?, title? })`. Fetches, extracts, computes `contentHash` (sha256 of extracted text), upserts the `sources` row, inserts a `snapshots` row (skips insert and returns the existing one if a snapshot with the same `sourceId` and `contentHash` already exists). `publishedAt` precedence: explicit argument → extracted → `fetchedAt`.
4. Create `src/lib/ingest/providers.ts` with `interface SourceProvider { id: "seeded" | "manual_url" | "search"; discover(competitor): Promise<SourceCandidate[]> }`. Implement `SeededProvider` (reads the manifest) and `ManualUrlProvider` (wraps one URL). Leave a `SearchProvider` stub that throws `NotImplemented` so the extension point is visible.
5. Curate the corpus manifest at `data/corpus/buffer/manifest.json`: an array of `{ url, sourceType, publishedAt, archiveTimestamp?, note }`. Target 12–18 real, unedited Buffer pages across three cutoffs. Use WebSearch/WebFetch to confirm each URL exists and its date, prefer Buffer's own domains (`buffer.com/resources`, `buffer.com/open`, `support.buffer.com`, `buffer.com/pricing` via Wayback, `buffer.com/agencies`, Buffer's changelog, careers page via Wayback). Required arc:
   - Run 1 (cutoff 2023-12-31): the Agency plan exists and Buffer talks about agencies (pricing snapshot showing Agency $100/mo for 10 channels, support article on the new plans, an agency-focused blog post or landing page, a customer story).
   - Run 2 (cutoff 2024-12-31): evidence that looks like doubling down (mid-2024 pricing snapshot with Agency at $100 after the 2024 cut, agency landing page, any post or changelog about client management / approval workflows). Include a second snapshot of `buffer.com/pricing` so change detection fires.
   - Run 3 (cutoff 2026-01-31): the reversal (pricing snapshot after November 2025 showing Free / Essentials / Team only and the FAQ line "Our pricing was last updated in November 2025", Buffer's own post or support article on the change, the agencies FAQ that says agencies pay per channel). Include a third `buffer.com/pricing` snapshot.
   Third-party pages (pricing trackers, news) are allowed only as `press`/`other` and only when a first-party page cannot be found.
6. Create `scripts/fetch-corpus.ts`: reads the manifest, calls `fetchPage` + `extractReadable` for each entry, writes `data/corpus/buffer/snapshots/{index}-{slug}.json` with the full snapshot fields (`url, sourceType, title, publishedAt, fetchedAt, archiveUrl, rawHtml, extractedText, contentHash`). Skips entries whose JSON file already exists unless `--force`. Prints a table of what it fetched and the extracted text length. Entries that fail are reported and the script continues.
7. Create `data/seed/company.json` (the user's company: "Loop", a social-media scheduling tool for small marketing agencies and freelancers, with product/customers/positioning/priorities/constraints filled in), `data/seed/competitors.json` (Buffer with website and description) and `data/seed/questions.json` (5 research questions, including "Are they investing in agencies as a segment and channel?" and "How is their pricing model changing and who does it favor?").
8. Create `scripts/seed.ts`: wipes all tables, inserts company, competitor, questions, then loads every corpus snapshot JSON into `sources` + `snapshots` via the same upsert used by `createSnapshot` (factor a `insertSnapshotRecord` helper so seeded and live records are identical). Prints counts.
9. Tests: `extract.test.ts` with a small HTML fixture (title, article, published meta). `snapshot.test.ts` using an in-memory DB and a stubbed fetch, asserting dedupe by content hash and `publishedAt` precedence.
10. Run `npm run corpus:fetch` then `npm run seed`. Commit the manifest, the snapshot JSON files (they are the demo's evidence and must be reproducible), and the seed files.

## Acceptance criteria

- [x] AC1: `data/corpus/buffer/snapshots/` contains at least 12 snapshot JSON files, each with non-empty `extractedText`, a `publishedAt` date, and a `url` on a real domain.
- [x] AC2: At least 3 snapshots share the URL `https://buffer.com/pricing` with different `contentHash` values and `publishedAt` dates falling in each of the three run windows.
- [x] AC3: `npm run seed` loads the company, one competitor, 5 research questions and all snapshots; running it twice gives the same counts.
- [x] AC4: `createSnapshot` with a live URL (for example a Buffer blog post not in the manifest) produces a row indistinguishable in shape from seeded rows, and a failed fetch throws `FetchError` with a readable message.
- [x] AC5: `npm test` and `npm run check` pass.
