# Delta prototype

## Outcome

Insights no longer repeat across runs (the demo database already holds near-duplicates such as "feature parity on approvals and reporting" written twice); each insight carries a score built from the partner's weighting (relevance 35%, novelty 25%, evidence 25%, actionability 15%); and a **digest content model** answers "what changed since the last digest" per competitor, shown in the dashboard before any email exists. Quiet periods are detected rather than padded.

## Step-by-step

1. **Schema** (`drizzle-kit generate --name insight-scores`): `insights` add `score` real nullable, `score_breakdown` JSON, `relevance_note` text, `actionability` int, `supersedes_insight_id` int nullable, `fingerprint` text; `INSIGHT_STATUSES` add `superseded`. Index on `(competitor_id, status)`.

2. **Insights prompt** (`src/lib/pipeline/prompts/insights.ts` + schemas/wire): the user prompt now lists prior active insights (`I<id>`, title, hypothesis ids, severity, run). Each new insight must output `updatesInsightId: number | null`, `relevance: 1–5` with `relevanceNote` naming the company priority or constraint it touches (quote the priority text), and `actionability: 1–5`. Rules: "If an insight restates an existing one and cites no new change facts, do not emit it; emit it with `updatesInsightId` only when there is new evidence or a changed recommendation." Keep 1–5 per run, 0 allowed.

3. **Dedupe and scoring** `src/lib/pipeline/rank.ts`:
   - `fingerprint(insight)`: sha1 of sorted `hypothesisIds` plus the five most frequent stemmed title tokens (simple suffix stripping, stop-words removed).
   - Update detection: the model's `updatesInsightId` if valid; else Jaccard similarity of title tokens ≥ 0.6 **and** identical `hypothesisIds` set against active insights ⇒ treat as update. On update: old row `status = 'superseded'`, new row `supersedes_insight_id = old.id`; reactions and corrections stay on the old row and are shown on the new one via the chain.
   - `score(insight, ctx)` = `0.35·relevance/5 + 0.25·novelty + 0.25·evidence + 0.15·actionability/5`, where novelty = 1.0 for a brand-new insight, 0.7 when superseding with ≥ 1 cited `isChange` fact, 0.5 when any cited hypothesis moved ≥ 0.1 this run, else 0.2; evidence = `0.5·mean(cited fact importance)/5 + 0.5·mean(cited hypothesis confidence)`. Clamp to [0, 1]. Persist `score`, `score_breakdown` (`{ relevance, novelty, evidence, actionability }`).
   - Called from `runInsights` after validation; unit-tested in isolation.

4. **Digest content model** `src/lib/digest/content.ts` (pure, no rendering): `buildDigestContent(db, { since, until })` →
   ```ts
   { company, period: { since, until }, quiet: boolean, competitors: [{
       competitor, runs: Run[],
       hypothesesMoved: { hypothesis, prev, next, change, reasoning }[],     // from hypothesis_updates in period
       topInsights: Insight[],                                               // status new|acknowledged, not superseded, score ≥ 0.45, max 3, score desc
       changes: { fact, snapshot, previousSnapshot? }[],                     // facts.isChange in period, grouped by URL
       questionsResolved: OpenQuestion[], questionsRaised: OpenQuestion[], conflicts: OpenQuestion[],
       pagesChecked: number, pagesChanged: number,                           // from sources.last_checked_at / last_changed_at in period
   }] }
   ```
   `quiet` is true when no competitor has a top insight, a hypothesis move ≥ 0.1, or a change fact with importance ≥ 4. Thresholds live in `src/lib/digest/thresholds.ts` so phase 12 can tune them.

5. **Dashboard.** Overview (`src/components/overview.tsx`): when a digest content period exists (initially: since the previous completed run), render a "Since <date>" strip using the content model alongside the existing `RunDelta`. Insights tab (`insights-feed.tsx`): sort by `score` desc then run; show a score chip with a tooltip of the breakdown and the relevance note; collapse superseded insights under the one that replaced them with a "history" toggle.

6. **Queries.** Extend `src/lib/queries.ts` with `listActiveInsights(competitorId)` and the chain lookup; keep `getCompetitorWorkspace` shape stable for existing components.

7. **Tests.** `rank.test.ts`: fingerprint stability, Jaccard update detection, score arithmetic on fixtures, novelty rules. `content.test.ts`: in-memory DB with two runs → correct hypotheses moved, top-3 selection, quiet detection, pagesChecked/Changed from `sources` timestamps. Mock insights handler emits `updatesInsightId` on the second run so `run.test.ts` can assert `superseded`.

## Acceptance criteria

- [x] AC1 (run with the StepFun models; no Anthropic key available): Running the Buffer replay (Run 1–3) with the default models produces no two active insights with Jaccard ≥ 0.6 on the same hypothesis set; a superseded row links to its replacement.
- [x] AC2: Every insight written after this phase has `score`, `score_breakdown` and `relevance_note`; the Insights tab is ordered by score.
- [x] AC3: `buildDigestContent` on the demo database for the Run 3 period returns Buffer's hypothesis moves (H1 strengthened to 0.85, H4→H7, H6→H8), ≤ 3 top insights, and `quiet = false`; for a period with no runs it returns `quiet = true`.
- [x] AC4: Unit tests for ranking and the content model pass offline; `npm run check`, `npm test`, `npm run eval:gates` pass; `drizzle/0006_*.sql` committed.
