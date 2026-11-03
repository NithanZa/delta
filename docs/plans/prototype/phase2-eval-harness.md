# Delta prototype

## Outcome

Trust is measurable before any feature work: a deterministic gate script checks every database for zero-tolerance failures (non-verbatim quotes, cutoff leakage, dangling ids, bad confidences); a regression suite encodes the failure modes the audit found and runs them against the real configured models; a golden timeline for Buffer and SocialPilot measures recall; a sampler produces weekly labeling sheets. The gates run in CI on the demo database. The regression suite is expected to be partly red until phase 3 lands, and the baseline is recorded.

## Step-by-step

1. **Layout.** New top-level `eval/` (excluded from `next build` by not being under `src/`; included in `tsconfig.json` `include` so `npm run check` type-checks it). Sub-folders: `eval/lib/`, `eval/cases/`, `eval/golden/`, `eval/labels/`, `eval/results/` (gitignored except `baseline-*.md`). npm scripts: `eval:gates`, `eval:regress`, `eval:recall`, `eval:sample`.

2. **Deterministic gates** `eval/gates.ts --db <path>` (default `data/delta.db`; opens read-only via `createDb` then `pragma query_only`). Checks, each reported with counts and the first 10 offending ids:
   - G1 quote fidelity: every `facts.quote` passes `quoteIsVerbatim(quote, snapshot.extractedText)` (`src/lib/pipeline/verbatim.ts`); facts with `claim_kind = 'absence'` (phase 3) are exempt. Target 100%.
   - G2 point-in-time: for every fact, `snapshots.publishedAt <= runs.cutoffDate` of the run that produced it; for every hypothesis update, every cited fact's snapshot date ≤ that run's cutoff. Target 100%.
   - G3 id integrity: every id in `hypothesis_updates.factIds`, `insights.factIds`, `insights.hypothesisIds`, `timeline_events.factIds/relatedEventIds`, `strategy_profiles.profile.*.factIds` resolves to a row of the same competitor.
   - G4 confidence sanity: `0 < confidence < 1` on hypotheses and updates; no NaN; a `revised` row has `supersedesId` pointing at a `retired` row.
   - G5 citations: every insight cites ≥ 1 fact; every hypothesis update except `retired` cites ≥ 1 fact.
   Exit code 1 on any G1/G2 violation or on G3–G5 above 0. Print a markdown table. Expose the checks as functions in `eval/lib/gates.ts` so phase 7 can run them on a digest's cited facts.

3. **Regression case format** `eval/cases/E01-annual-vs-monthly.json`:
   ```json
   {
     "id": "E01", "kind": "extract",
     "snapshot": { "url": "https://buffer.com/pricing", "sourceType": "pricing", "publishedAt": "2026-10-31", "textFile": "E01.txt" },
     "expect": {
       "facts": {
         "mustInclude": [{ "category": "pricing", "billingCadence": "annual", "statementMatches": "\\$10" }, { "category": "pricing", "billingCadence": "monthly", "statementMatches": "\\$12" }],
         "mustNotInclude": [{ "statementMatches": "(price )?(cut|drop|reduc|lower)" }],
         "min": 2
       }
     }
   }
   ```
   Kinds: `extract` (one snapshot), `change` (previous + current snapshot of the same URL; expectations on change facts), `synthesis` (a prepared state: prior facts, hypotheses, questions, plus new facts; expectations on hypothesis updates, open questions, profile text), `insights`. Matchers: `statementMatches` (regex, case-insensitive), `quoteMatches`, field equality for `category`, `billingCadence`, `availability`, `claimKind`, `importance >=`. Fixture texts live in `eval/cases/fixtures/*.txt`; make them 300–2000 words so they resemble real pages (copy passages from `data/corpus/*/snapshots/*.json` `extractedText` where possible, dated to match).

4. **Cases to write (all from the audit; expected status after phase 3 in brackets):**
   - E01 annual vs monthly on one page (`$10/mo billed yearly` next to `$12 monthly`) → both facts with cadence; no "cut" [green after P3].
   - E02 change detection, monthly display → annual display of the same price → no change fact matching cut/drop/reduce [P3].
   - E03 "Guest access is one of the next major releases on the roadmap" → `availability = coming_soon`, statement not asserting availability (`!/now available|launched|shipped/`) [P3].
   - E04 "Introducing Community … free for up to three channels" → `availability = shipped`, category product [green now].
   - E05 synthesis with no absence check in the record and a model tempted to assert "no partner program" → stored confidence ≤ 0.4 and `claim_kind = absence` [P3, tested with a mock emitting 0.8 so the code cap is exercised deterministically, plus a real-model variant].
   - E06 two official pages disagree (plans page 25 accounts vs pricing page 20) → an open question with `kind = conflict` citing both fact ids; profile summary mentions both or says "conflicting" [P3].
   - E07 a feature line disappears from a page but a separate product page exists → change statement says "no longer listed" and not "discontinued|removed the product" [P3].
   - E08 every change statement matches `Between \d{4}-\d{2}-\d{2} and \d{4}-\d{2}-\d{2}` [green now, keep].
   - E09 pricing page with 40 numbers → ≥ 5 facts, all quotes verbatim (G1 on the case DB) [green].
   - E10 synthesis given a prior fact dated after the run cutoff → the pipeline throws before calling the model (`assertPointInTime`, P3) [P3].
   - E11 Agency plan removed and volume bands added between captures → one change about the plan no longer listed and one about `$4|$3|$2` bands [green].
   - E12 `$5 · $10 · $100 … billed annually` block → all three with cadence annual [P3].
   - E13 acquisition announcement (group.one / SocialPilot text) → a fact with `statementMatches: "acqui"` and `importance >= 4` [green].
   - E14 API launch post mentioning AI agents → category product, availability shipped, statement mentions API [green].
   - E15 affiliate program page → category distribution, statement contains `20%` and `affiliate` [green].
   - E16 page that is mostly cookie banner and navigation → 0 facts mentioning cookie/privacy/navigation [green].
   - E17 synthesis honours a pending user correction (real model) → reasoning contains the correction's key phrase [green].
   - E18 insights never contain generic advice: no action text matching `keep monitoring|continue to monitor|stay aware` [green].

5. **Runner** `eval/regress.ts [--only E01,E05] [--kind extract]`: for each case, create `createDb(":memory:")`, insert the Loop company and the competitor, insert fixture snapshots via `insertSnapshotRecord`, create a run row with the case cutoff, call `extractFactsForSnapshot` / `detectChangesForSnapshot` / `runSynthesis` / `runInsights` with the real client (honours `LLM_*` env), evaluate matchers, run G1/G2 on the case DB, print PASS/FAIL per case with the offending matcher and the model output excerpt, write `eval/results/regress-<ISO timestamp>.json`, exit 1 on failure. Guard against cost: print the estimated cost from `RunStats` at the end, and refuse to start when `DELTA_MOCK_LLM=1` is set (the suite only means something against real models).

6. **Golden timeline** `eval/golden/buffer.json` and `socialpilot.json`: events the record should contain, each `{ id, date, windowDays: 45, anyOf: ["keyword", ...], source }`. Seed from the audit's confirmed facts and recall misses: Buffer Agency plan listed at $120/10 channels (2023); Agency plan gone from pricing (2025); volume bands $4/$3/$2 (Nov 2025); Agency Partner Program 25% recurring (by 2026-06-17); Community launch (2025-11-12); public API with MCP and CLI (2026-05-27); Threads and Bluesky added (2024); SocialPilot acquired by group.one (2025-07-10); SocialPilot MCP server (2026-04-09); AI Assistant renamed AI Pilot; Ultimate tier $200/mo flat. `eval/recall.ts --db` scans `facts.statement + quote` and `timeline_events.title + summary` within the window and prints found/total with the missing list. Phases 4, 8 and 10 raise this number.

7. **Labeling sampler** `eval/sample.ts --db --since <date> --n 25 --out eval/labels/<date>.csv`: stratified (10 change facts, 5 pages checked with no change, 5 hypothesis updates, 5 random insights/facts) with columns `id, kind, text, quote, source_url, published_at, confidence, label, note`. `eval/labels/README.md` holds the five labels (Supported, Partially supported, Unsupported, Contradicted, Post-cutoff/Stale), the rule "label before looking at confidence", and the thresholds from the audit (hard-fact precision ≥ 98% floor / 99% target, quotes 100%, stale+dup ≤ 5%).

8. **CI** `.github/workflows/ci.yml`: Node 22, `npm ci`, `npm run check`, `npm test`, `npm run eval:gates -- --db data/demo/delta.demo.db`. No model calls in CI.

9. **Baseline.** Run `npm run eval:regress` once on the current prompts with the phase-1 default models; save `eval/results/baseline-2026-11.md` listing pass/fail per case (expected failures: E01, E02, E03, E05, E06, E07, E10, E12) and the cost.

## Acceptance criteria

- [x] AC1: `npm run eval:gates -- --db data/demo/delta.demo.db` passes G1–G5; a unit test that tampers a quote in an in-memory DB makes G1 fail with exit code 1.
- [x] AC2: `npm run eval:regress` runs all 18 cases against the configured models, prints a per-case table, writes a results JSON, and exits non-zero while any case fails.
- [x] AC3: `npm run eval:recall -- --db data/demo/delta.demo.db` prints found/total for both golden files and lists the missing events.
- [x] AC4: `npm run eval:sample -- --db data/demo/delta.demo.db --n 25` writes a 25-row CSV with the documented columns.
- [x] AC5: CI workflow runs check, test and gates on push; `eval/results/baseline-2026-11.md` is committed.
