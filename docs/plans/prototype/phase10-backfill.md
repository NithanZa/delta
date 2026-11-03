# Delta prototype

## Outcome

"Backfill 24 months" gives a new competitor the history that made the demo compelling: Wayback Machine captures of the watchlist pages at quarterly cutoffs, replayed as `backfill` runs so the first digest already carries hypotheses with provenance across two years. The job is bounded, resumable, visible, rate-limited, and protected by the point-in-time guard; discovery can optionally backfill per window.

## Step-by-step

1. **CDX client** `src/lib/ingest/wayback.ts`: `listCaptures(url, { from, to, fetchImpl })` queries the CDX API (API notes) with `output=json`, `fl=timestamp,original,statuscode,digest`, `filter=statuscode:200`, `collapse=timestamp:6` (one capture per month), parses the header row, returns `[{ timestamp, original, digest, date: 'YYYY-MM-DD' }]`. `pickCaptureBefore(captures, cutoffDate)` returns the latest capture with `date <= cutoff`. Politeness: one request per second, `User-Agent` as in phase 4, 60 s timeout, retry on 429/503 honouring `Retry-After` (max 3), and a per-job budget of 200 CDX calls.

2. **Plan** `src/lib/backfill/plan.ts`: `planBackfill(db, competitorId, { months: 24, step: 'quarter' | 'month' })` → cutoffs = quarter ends (or month ends) from `today - months` to the last completed quarter, ascending; URLs = watched sources (`watch = true`, `enabled = true`). For each URL, `listCaptures(url, { from: first cutoff - 3 months, to: today })` once, then for each cutoff pick the capture before it; dedupe consecutive identical `digest` values (same content → skip). Output: `{ cutoffs: [{ cutoffDate, fetches: [{ url, timestamp }] }], estimate: { pages, runs } }`.

3. **Execute** `src/lib/backfill/run.ts` as a worker job (`kind = 'backfill'`, payload `{ competitorId, months, step, withDiscovery }`): for each cutoff ascending: skip if a `done` run with `kind = 'backfill'` and that `cutoffDate` exists (resumable); fetch each planned capture with `createSnapshot(db, { url, sourceType, provider: 'backfill', publishedAt: captureDate, archiveTimestamp })` (the `id_` URL form and the content-hash dedupe already exist); optional discovery for the window `(previousCutoff, cutoff]` capped at 5 pages (phase 8 `discover` with `endPublishedDate = cutoff`); then `startRun({ kind: 'backfill', label: 'Backfill ≤ <cutoff>', cutoffDate })` + `executeRun`, streaming run events into the job log; stop after three consecutive failed runs. Finally enqueue a normal `run` job so anything newer is processed. The `assertPointInTime` guard (phase 3) makes leakage impossible even if a capture date is misread.

4. **Ordering guarantee**: `selectSnapshotsForRun` picks unprocessed snapshots `publishedAt <= cutoff`; because cutoffs ascend, each backfill run sees exactly its window. Document the invariant in `src/lib/backfill/README.md` with the failure mode (a later capture inserted after an earlier run would be picked up by the next run, which is correct).

5. **UI**: competitor page gets "Backfill history (24 months)" in the run panel (disabled while a job runs) → enqueues; a progress panel polls `/api/jobs/<id>` and shows cutoffs done/total, pages fetched, current stage; Evidence tab already badges Wayback captures; the Overview "Replaying archived pages" note becomes "History backfilled from Wayback captures between <from> and <to>". Onboarding step 3 button wires to the same action.

6. **CLI** `scripts/backfill.ts`: `npm run backfill -- --competitor <slug> [--months 24] [--step quarter|month] [--with-discovery] [--plan-only]` (prints the plan and estimate without fetching).

7. **Cost and time**: record in the job log the counts and the summed `costUsd` of backfill runs. Expectation for 5 watched URLs × 8 quarters: ≤ 40 CDX calls, ≤ 40 archive fetches (many deduped), 8 runs, 20–40 minutes, roughly $5–10 with Opus synthesis. Put the estimate on the button.

8. **Tests**: CDX JSON parsing fixture (header row, collapse), `pickCaptureBefore`, plan generation with fake captures (dedupe by digest, ascending cutoffs), execution with the mock client on an in-memory DB (runs created per cutoff, resumability skips done cutoffs, guard throws when a capture is mis-dated after its cutoff), `Retry-After` handling.

## API notes (verified 2026-11-02)

**Wayback CDX server** — `GET https://web.archive.org/cdx/search/cdx?url=<url>&output=json&fl=timestamp,original,statuscode,digest&filter=statuscode:200&from=20231101&to=20261102&collapse=timestamp:6`

- `url` is required; URL-encode it; `matchType` defaults to `exact` (`prefix`, `host`, `domain` also exist).
- `from`/`to`: inclusive timestamps, 1–14 digits `yyyyMMddhhmmss`.
- `filter=[!]field:regex`, repeatable (e.g. `filter=statuscode:200&filter=mimetype:text/html`); `!` negates.
- `collapse=timestamp:6` keeps one capture per month (first N chars of the timestamp compared); `collapse=digest` drops adjacent identical content.
- `output=json` returns an array whose **first row is the header** (`["timestamp","original","statuscode","digest"]`).
- `limit=N` first N, `limit=-N` last N (slow); `showResumeKey=true`/`resumeKey=` for paging; server max 150 000 rows.
- No published rate limit; bulk use is asked to page politely. Archived page bodies are fetched from `https://web.archive.org/web/<timestamp>id_/<url>` (already implemented in `src/lib/ingest/fetchPage.ts`); the server redirects inexact timestamps to the nearest capture.

## Acceptance criteria

- [x] AC1: `npm run backfill -- --competitor socialpilot --plan-only` prints 8 quarterly cutoffs and, for each watched URL, the chosen capture timestamp or "unchanged/skip".
- [x] AC2: Running the backfill on a fresh SocialPilot competitor (watchlist: plans, agencies pages) creates ≤ 8 `backfill` runs in ascending cutoff order, each processing only snapshots dated ≤ its cutoff, and ends by enqueueing a normal run.
- [x] AC3 (killed live from the CLI and with kill -9 on the worker container; both resumed with no cutoff run twice): Killing the worker mid-backfill and restarting resumes from the first cutoff without a `done` backfill run; no cutoff is run twice.
- [x] AC4 (2 of 4 SocialPilot golden events including the $200 tier; Buffer history not backfilled in this test): `npm run eval:gates` G2 (point-in-time) passes on the backfilled database; `npm run eval:recall` finds the pricing-history golden events.
- [x] AC5 (progress written to the job payload and asserted in a test; the polling panel renders but was not watched in a browser): The dashboard progress panel reflects cutoffs done/total during the job; `npm run check`, `npm test` pass.
