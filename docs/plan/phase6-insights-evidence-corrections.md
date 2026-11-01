# Delta MVP

## Outcome

The Insights, Evidence and Questions tabs are complete. Each insight separates fact, inference and action, links to its evidence, and can be corrected by the user; corrections feed the next run. Users can add a live URL that goes through the same ingestion pipeline and shows up as evidence for the next run.

## Step-by-step

1. Insights tab (`src/components/insights-feed.tsx`): list ordered by run (newest) then severity. Each card shows title, severity badge, run badge, and the four labeled sections: **Observed** (whatHappened), **Inferred** (whatItMeans), **Why it matters to {company}** (whyItMatters), **Recommended** (whatToDoNext + the action list with `respond`/`investigate` badges). Footer: linked hypotheses (chips that jump to the Overview card) and "n facts" that expands an inline evidence list.
2. Evidence list component (`src/components/evidence-list.tsx`): for a set of fact ids, renders each fact's statement, verbatim quote in a blockquote, category badge, `isChange` badge ("changed since previous snapshot"), event date, and the source snapshot (title, domain, published date, link to URL / archive). Reused by insights, hypotheses history, and strategy profile dimension cards.
3. Insight actions (server actions in `src/app/c/[slug]/actions.ts`): `setInsightStatus(id, status)` (acknowledge / dismiss) and `correctInsight(id, text)`; `correctHypothesis(id, text)` stores `userCorrection` on the hypothesis only (no `hypothesisUpdates` row; the next run's synthesis prompt receives the correction as authoritative because the phase 4 context already includes `userCorrection`). A "Corrected by you" badge appears on the card. Add a small textarea form (client component) with optimistic UI.
4. Evidence tab: all snapshots for the competitor grouped by run window ("Seen in Run 1", …, "Not yet processed"), each with source type, published date, fetched date, archive link, fact count and an expandable facts list. Supports `?facts=1,2,3` query param to show only those facts (used by links from Overview/Insights). A "Pending" group lists snapshots with no facts yet (for example, live URLs added after the last run).
5. Add URL form (client, `src/components/add-url-form.tsx`) on the Evidence tab: inputs URL and source type; POSTs to `/api/sources` which calls `createSnapshot` with `provider = "manual_url"`. Success shows the snapshot card with "will be analyzed in the next run"; failure shows the `FetchError` message inline (for example "page is mostly JavaScript") and does not block anything else.
6. Questions tab: open questions (with the run that raised them) and resolved ones (with resolution and the run that resolved them). Each question has "Mark resolved" with a note (server action). Open questions are rendered in the RunPanel as "n follow-ups queued for the next run".
7. Run detail: a `RunChip` click opens `/c/[slug]/runs/[id]` showing the run's stats, the log, token usage, and what changed in that run (hypothesis updates, new timeline events, new insights, questions raised/resolved). This is the "evidence history / how conclusions changed" view.
8. Hypothesis history inline diff: when a hypothesis was `revised`, show old statement struck through above the new one on the Overview card.
9. Keyboard/accessibility: tabs are buttons with `aria-selected`, expandable sections use `<details>`, color is never the only status signal (badges have text).
10. Run through the full demo in the browser: reset, Run 1, inspect, Run 2, inspect, correct one hypothesis, Run 3, confirm the correction shows in the synthesis reasoning, add a live URL, confirm it is pending. Fix what breaks. Commit.

## Acceptance criteria

- [x] AC1: Each insight card displays the Observed / Inferred / Why it matters / Recommended sections and its actions with `respond`/`investigate` badges, and expanding "facts" shows verbatim quotes with source links.
- [x] AC2: Correcting a hypothesis stores `userCorrection`, shows a "Corrected by you" badge, and the next run's synthesis reasoning references the correction (verified in the run detail page).
- [x] AC3: Adding a live URL on the Evidence tab creates a snapshot that appears under "Not yet processed", and the next run extracts facts from it; a bad URL shows an inline error and the page remains usable.
- [x] AC4: Open questions show in the Questions tab and the RunPanel count; marking one resolved moves it to the resolved list.
- [x] AC5: The run detail page lists hypothesis updates, timeline events, insights and questions for that run with the run log.
- [x] AC6: `npm run check`, `npm test`, and `npm run build` pass.
