# Delta MVP

## Outcome

The web app shows the company profile, the competitor workspace, and lets the user start a replay run and watch its progress stream in. After a run, the Strategy Profile, Hypotheses and Timeline tabs show the persisted results with evidence links.

## Step-by-step

1. Design system in `src/app/globals.css` + `src/components/ui/`: a restrained dark-neutral theme with one accent, Tailwind v4 tokens (`--color-accent`, `--color-surface`, `--color-muted`, status colors for strengthened/weakened/contradicted/revised). Small primitives: `Button`, `Card`, `Badge`, `Tabs` (client, URL-synced via `?tab=`), `ConfidenceBar`, `EmptyState`, `Spinner`. No component library; keep each primitive under 40 lines.
2. Layout `src/app/layout.tsx`: top bar with "Delta" wordmark, the company name, and a nav link to Settings; main content max-width container. Fonts: keep Geist from the scaffold.
3. Data access in `src/lib/queries.ts` (server-only): `getCompany()`, `listCompetitors()`, `getCompetitorWorkspace(slug)` returning the competitor, runs (newest first), active hypotheses with latest update, latest strategy profile, timeline events, insights, open questions, snapshot counts per run window, and the next replay preset. Keep all Drizzle queries here so pages stay thin.
4. Home `src/app/page.tsx` (server): company card (name, product, target customers, positioning, priorities, constraints) with an "Edit" link to `/settings`; competitor list cards with slug links, run count, last run date, and insight count. Empty state when no company row tells the user to run `npm run seed`.
5. Settings `src/app/settings/page.tsx`: a server-action form (`src/app/settings/actions.ts`) to edit the company profile and the research questions per competitor. Validate with Zod; `revalidatePath("/")` after save.
6. Competitor workspace `src/app/c/[slug]/page.tsx` (server, `params` is a Promise): header with name, website, "Replaying snapshots captured on {min fetchedAt} – {max fetchedAt}" label, and the `RunPanel`. Tabs: Overview, Timeline, Insights, Evidence, Questions. This phase implements Overview and Timeline; phase 6 implements the rest (render placeholders with the EmptyState so the tab switch works).
7. `RunPanel` (client, `src/components/run-panel.tsx`): shows completed runs as chips (label, cutoff date, counts) and a primary button "Run {next label} (sees pages dated ≤ {cutoff})". Clicking POSTs to `/api/runs` and reads the NDJSON stream, rendering a live log (stage, message) and a progress count; on completion calls `router.refresh()`. Disabled while a run is in `running` state. Shows an error banner with the run error when `status = failed`.
8. API route `src/app/api/runs/route.ts`: `POST { competitorId, label?, cutoffDate? }` → creates the run (defaults from `nextReplayRun`) and returns a `ReadableStream` of NDJSON events from `executeRun`. `GET /api/runs/[id]` returns the run row (log, status) for recovery when the stream drops; `RunPanel` polls this every 2s if the stream errors while status is `running`.
9. Overview tab: left column Strategy Profile (five dimension cards: summary, confidence bar, "n sources" link that opens the Evidence tab filtered to those fact ids). Right column Hypotheses: cards grouped by dimension with statement, confidence bar, status badge, "updated in Run N", and an expandable history list of `hypothesisUpdates` (change, prev → new confidence, reasoning, linked facts). Retired hypotheses appear collapsed under "Superseded" with a link to the row that replaced them.
10. Timeline tab: vertical list ordered by `eventDate` with the run badge in which it was discovered, summary, source chips (snapshot title + domain, linking to the source URL and the archive URL when present), and "related to" links that scroll to earlier events.
11. Loading and error UI: `loading.tsx` skeletons for the workspace, `error.tsx` with a retry button, and `not-found.tsx` for unknown slugs.
12. Verify in the browser with the seeded DB and the completed replay runs from phase 4. Commit.

## Acceptance criteria

- [x] AC1: `/` shows the seeded company and the Buffer competitor card; `/settings` saves edits to the company profile and research questions and they appear on `/`.
- [x] AC2: On `/c/buffer`, clicking "Run" starts a run, the log streams at least the select/extract/synthesis/insights/finalize stages, and the page refreshes with results without a manual reload.
- [x] AC3: Overview shows the strategy profile with five dimensions and confidence bars, and hypothesis cards with status badges and an expandable update history including reasoning.
- [x] AC4: Timeline lists events in date order with source links that open the original or archived page.
- [x] AC5: A replay label "Replaying snapshots captured on …" is visible on the workspace header.
- [x] AC6: `npm run check`, `npm test`, and `npm run build` pass.
