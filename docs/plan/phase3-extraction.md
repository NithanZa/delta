# Delta MVP

## Outcome

Given a run and a set of snapshots, Delta extracts observed facts with verbatim quotes using `step-3.7-flash`, and detects changes between successive snapshots of the same URL. Facts are stored against the run and snapshot.

## Step-by-step

1. Create `src/lib/pipeline/schemas.ts` with Zod schemas shared by the pipeline and the UI: `FactSchema` (`statement`, `quote`, `category`, `eventDate` nullable ISO date, `importance` 1–5), `ExtractFactsOutput` (`{ facts: Fact[] }`), `ChangeOutput` (`{ changes: Fact[] }` with `isChange: true` applied by code, not the model).
2. Create `src/lib/pipeline/prompts/extractFacts.ts`: system prompt that defines the analyst role, the company context (name, product, target customers, priorities) and the research questions, and instructs: observed facts only, no inference, every fact needs a verbatim quote from the page, prefer specifics (segments named, prices, features, partners, roles hired, messaging changes), 3–12 facts per page, `eventDate` is the page's published date unless the text states a different date for the event. User prompt includes `url`, `sourceType`, `publishedAt`, `title`, and the extracted text (truncate to 40k chars).
3. Create `src/lib/pipeline/prompts/detectChange.ts`: given two extracted texts of the same URL (previous and current, each truncated to 25k chars) plus their dates, return only what changed (added, removed, repriced, renamed), each with a quote from the current or previous version and a statement that names both the old and new state.
4. Create `src/lib/pipeline/extract.ts`:
   - `selectSnapshotsForRun(competitorId, cutoffDate)` returns snapshots with `publishedAt <= cutoffDate` that have no facts yet for this competitor (so Run 2 only processes pages Run 1 did not see).
   - `extractFactsForSnapshot(run, snapshot, ctx)` calls `callJson` with `MODELS.fast`, maps output to `facts` rows, and returns them.
   - `detectChangesForSnapshot(run, snapshot)` finds the most recent earlier snapshot with the same `sourceId` (any run) and, if present and the hashes differ, calls the change prompt and stores facts with `isChange = true`.
   - `runExtraction(run, ctx, onProgress)` runs both over the selected snapshots with `p-limit(4)`, emitting progress events `{ stage: "extract", snapshotId, url, factCount }`.
5. Add a `quoteIsVerbatim(quote, text)` check (normalized whitespace, case-insensitive substring, allow quotes ≥ 20 chars that match ≥ 85% via a sliding window) and drop facts whose quote fails it, logging the drop into the run log. This is what lets the UI claim "every fact is backed by a passage from the source".
6. Mock responses: add `extract_facts` and `detect_change` canned outputs to `src/lib/stepfun/mock.ts` that are built from the input text (take the first few sentences as quotes) so tests pass the verbatim check.
7. Tests: `extract.test.ts` with in-memory DB, two snapshots of one URL with different hashes and one new page; assert facts are stored, change facts are flagged, selection excludes snapshots already processed, and a fact with a fabricated quote is dropped.
8. Commit.

## Acceptance criteria

- [ ] AC1: `runExtraction` on the seeded Run 1 cutoff (real API) stores facts for every Run 1 snapshot, each with a quote that passes `quoteIsVerbatim`.
- [ ] AC2: Running extraction for Run 2 after Run 1 only processes snapshots not already processed and produces at least one `isChange = true` fact for `https://buffer.com/pricing`.
- [ ] AC3: Facts with non-verbatim quotes are dropped and the drop is recorded in the run log.
- [ ] AC4: `npm test` and `npm run check` pass.
