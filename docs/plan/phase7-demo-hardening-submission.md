# Delta MVP

## Outcome

The demo is reliable without the network, the repository explains itself to judges, and the submission package can be produced with one command. A pre-computed demo database with all three replay runs ships with the repo so the UI is fully populated even if the API is unavailable; a reset path lets the presenter run the replays live.

## Step-by-step

1. Demo database: run `npm run demo:reset`, then the three replay runs with the real API, then copy `data/delta.db` to `data/demo/delta.demo.db` (gitignore exception). Add `npm run demo:restore` (`scripts/demo-restore.ts`) that copies the demo DB over `data/delta.db`. Add `npm run demo:fresh` = `demo:reset` (seeded, no runs) for the live-run version of the demo.
2. Resilience: in `callJson`, add a 90s timeout per call and one retry on network errors; in `executeRun`, if extraction fails for a single snapshot, log and continue. In the RunPanel, if the stream drops, fall back to polling (phase 5 step 8) so a long Step 5 Preview call never looks like a hang.
3. Cost/latency check: record per-run token usage and wall time in `runs.stats`; put the numbers from the real replay runs in the README. If Run 2 or Run 3 takes more than ~3 minutes, trim the synthesis prompt's prior-facts list to the top 60 by importance plus all facts cited by active hypotheses.
4. Model-role explanation: `docs/stepfun-integration.md` describing exactly which model does what (`step-3.7-flash` for per-page fact extraction and change detection with verbatim-quote enforcement; `step-5-preview` with 1M context for cross-source synthesis, hypothesis revision and company-specific recommendations), the prompts' rules (facts vs inference, cite ids, corrections are authoritative), the JSON-mode + Zod validation + retry pattern, and the measured usage. Judges weight "Meaningful Use of StepFun Models" at 25%; this document is the answer.
5. README rewrite: what Delta is (one paragraph), the demo story (Buffer's Agency plan: created → strengthened → contradicted → revised), quick start (`npm install`, `.env.local`, `npm run db:push`, `npm run seed`, `npm run demo:restore` or run live, `npm run dev`), the replay disclosure, the architecture (ingestion → extraction → synthesis → insights, SourceProvider extension point), the stack, and the honest limitations (no search provider yet, single competitor seeded, Wayback captures for historical pages).
6. Demo script `docs/demo-script.md`: a 4-minute walkthrough (problem → company profile → Run 1 results → Run 2 strengthens → Run 3 contradicts and revises → insight with investigate action → correct a hypothesis → add a live URL) with what to say at each step and which tab to be on. Include the fallback plan (restore demo DB) and the two screenshots to take.
7. Submission packaging: `npm run package` (`scripts/package.ts`) builds a zip `dist/delta-submission.zip` containing the repo without `node_modules`, `.next`, `.env.local`, but including `data/demo/delta.demo.db` and `data/corpus`. Verify it unzips and runs with the quick start.
8. Final pass: `npm run check`, `npm test`, `npm run build`, `npm start` smoke in the browser on a restored demo DB. Commit with a tag `submission-v1`.

## Acceptance criteria

- [ ] AC1: `npm run demo:restore && npm run dev` shows all three runs with hypotheses, timeline, insights and questions populated without any API call.
- [ ] AC2: `npm run demo:fresh` followed by three clicks of "Run" in the UI reproduces the arc with the real API (or fails visibly with a readable error, never a silent hang).
- [ ] AC3: `docs/stepfun-integration.md` names both models, their roles, and measured token usage per run.
- [ ] AC4: `README.md` quick start works from a fresh clone of the zip in `dist/`.
- [ ] AC5: `npm run check`, `npm test`, and `npm run build` pass; the repo is tagged `submission-v1`.
