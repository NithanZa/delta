# Delta MVP

## Outcome

The repo has its data layer, StepFun client, test runner and scripts in place. `npm run check` (lint + typecheck) and `npm test` pass. The SQLite database can be created from the Drizzle schema with one command. The StepFun client can make a JSON-mode call validated by a Zod schema, with a mock mode for tests.

## Step-by-step

1. Install runtime deps: `drizzle-orm`, `better-sqlite3`, `zod`, `openai` (used only as an OpenAI-compatible client pointed at `STEPFUN_BASE_URL`), `@mozilla/readability`, `jsdom`, `p-limit`. Dev deps: `drizzle-kit`, `@types/better-sqlite3`, `@types/jsdom`, `vitest`, `tsx`.
2. In `next.config.ts` set `cacheComponents: false` and `partialPrefetching: false` (every page reads SQLite at request time; the Cache Components model adds Suspense requirements we don't need) and add `serverExternalPackages: ["better-sqlite3", "jsdom"]`.
3. Add scripts to `package.json`: `check` = `tsc --noEmit && eslint`, `test` = `vitest run`, `db:push` = `drizzle-kit push`, `seed` = `tsx scripts/seed.ts`, `corpus:fetch` = `tsx scripts/fetch-corpus.ts`, `run` = `tsx scripts/run.ts`, `demo:reset` = `tsx scripts/demo-reset.ts`. Add `vitest.config.ts` with `@/` alias and `test.include = ["src/**/*.test.ts"]`.
4. Create `src/lib/env.ts`: reads `STEPFUN_API_KEY`, `STEPFUN_BASE_URL` (default `https://api.stepfun.ai/v1`), `DELTA_DB_PATH` (default `data/delta.db`), `DELTA_MOCK_LLM` (`"1"` means no network). `.env.local` already holds the key and base URL; add `.env.example` with placeholders.
5. Create `src/db/schema.ts` (Drizzle, SQLite) with these tables. All ids are integer autoincrement; JSON columns are `text` with `{ mode: "json" }`; dates are ISO strings.
   - `company`: name, description, product, targetCustomers, positioning, priorities, constraints, updatedAt. One row.
   - `competitors`: name, slug (unique), website, description, createdAt.
   - `researchQuestions`: competitorId, text, createdAt.
   - `sources`: competitorId, url (unique per competitor), sourceType (`blog|release_notes|pricing|docs|website|jobs|customer_story|press|interview|other`), provider (`seeded|manual_url`), title.
   - `snapshots`: sourceId, competitorId, url, sourceType, title, publishedAt, fetchedAt, rawHtml, extractedText, contentHash, archiveUrl (nullable, the Wayback URL when used).
   - `runs`: competitorId, label, cutoffDate, status (`queued|running|done|failed`), startedAt, finishedAt, log (JSON array of `{ts, level, message}`), stats (JSON), error.
   - `facts`: runId, competitorId, snapshotId, statement, quote, category (`segment|product|pricing|distribution|partnership|hiring|messaging|other`), eventDate, importance (1-5), isChange (boolean, true when derived from comparing two snapshots of one URL).
   - `timelineEvents`: competitorId, runId, eventDate, title, summary, factIds (JSON), relatedEventIds (JSON).
   - `hypotheses`: competitorId, dimension (`customers|product|positioning|distribution|business_model|next_moves`), statement, confidence (real 0-1), status (`active|strengthened|weakened|contradicted|revised|retired`), createdRunId, updatedRunId, supersedesId (nullable), userCorrection (nullable).
   - `hypothesisUpdates`: hypothesisId, runId, change (`created|strengthened|weakened|contradicted|revised|retired`), prevConfidence, newConfidence, reasoning, factIds (JSON).
   - `strategyProfiles`: competitorId, runId, profile (JSON: `{customers, productDirection, positioning, distribution, businessModel}` each `{summary, confidence, factIds}`).
   - `insights`: competitorId, runId, title, whatHappened, whatItMeans, whyItMatters, whatToDoNext, severity (`high|medium|low`), hypothesisIds (JSON), factIds (JSON), actions (JSON array of `{type: "respond"|"investigate", text, rationale}`), status (`new|acknowledged|dismissed`), userCorrection (nullable).
   - `openQuestions`: competitorId, createdRunId, question, status (`open|resolved`), resolvedRunId, resolution.
6. Create `src/db/index.ts` that opens `better-sqlite3` at `DELTA_DB_PATH` (creating `data/` if missing), enables WAL, and exports `db = drizzle(sqlite, { schema })`. Add `drizzle.config.ts` pointing at the schema and the same path. Add `data/*.db*` to `.gitignore` (the committed demo DB in phase 7 will be an explicit exception).
7. Create `src/lib/stepfun/client.ts`: `callJson<T>({ model, system, user, schema: ZodSchema<T>, maxTokens, temperature })`. Uses `openai` with `baseURL = STEPFUN_BASE_URL`, `response_format: { type: "json_object" }`, parses the content, validates with Zod, and on parse/validation failure retries once with the error appended to the prompt. Exports `MODELS = { fast: "step-3.7-flash", deep: "step-5-preview" }`. Exports a `LlmClient` interface so tests can inject a mock; when `DELTA_MOCK_LLM=1` the default client is `MockLlmClient` from `src/lib/stepfun/mock.ts`, which returns canned responses keyed by a `task` string the caller passes (`extract_facts`, `detect_change`, `update_hypotheses`, `generate_insights`).
8. Write `src/lib/stepfun/client.test.ts`: a fake OpenAI-compatible transport returns invalid JSON once then valid JSON; assert the retry path and Zod validation. Write `src/db/schema.test.ts` that pushes the schema into an in-memory DB (`:memory:`) and inserts one row per table.
9. Replace the scaffold `src/app/page.tsx` with a placeholder that renders "Delta" and nothing else (phase 5 builds the real UI); delete scaffold assets in `public/` that are unused.
10. Commit.

## Acceptance criteria

- [x] AC1: `npm run check` passes with zero errors.
- [x] AC2: `npm test` passes, including the client retry test and the schema insert test.
- [x] AC3: `npm run db:push` creates `data/delta.db` with all 12 tables.
- [x] AC4: `npx tsx -e` calling `callJson` against the real API with `step-3.7-flash` returns Zod-validated JSON (manual smoke, recorded in the commit message).
- [x] AC5: `.env.example` exists and `.env.local` is gitignored.
