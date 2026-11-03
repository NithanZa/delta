# Delta prototype

## Outcome

The whole prototype is exercised end to end as a dress rehearsal with Loop as a stand-in partner (Buffer and SocialPilot as competitors) on the hosted instance. Trust gates run before every send and hold a digest that fails them. The five instrumentation events feed a funnel on `/ops`, the 30-day question ships in the fourth digest, weekly labeling is set up with the audit's thresholds as go/no-go, and a partner runbook exists. The repo is tagged `prototype-v1`.

## Step-by-step

1. **Dress rehearsal script** `docs/pilot-rehearsal.md`, executed on the VPS and timed:
   1. `/onboarding` with Loop's site (use `data/seed/company.json` content on a throwaway page or the real site of a friendly startup) → answer the clarifying questions.
   2. Add Buffer and SocialPilot from their URLs; accept the proposed watchlists; add the feeds.
   3. Backfill 24 months for both; record duration and cost from the job logs.
   4. Discovery sweep (`--absence` included); check the Evidence tab groups and absence cards.
   5. Trigger the scheduled cycle (crawl → run) from `/ops`; confirm skip behaviour on the second trigger.
   6. Send the digest to your inbox; click Useful on one insight, Wrong on another; reply with a Buffer URL and two sentences ("our customers say Buffer's partner payouts are slow").
   7. Next run: the URL is processed, the internal note is cited as internal with a ≤ 0.1 move, the Wrong reaction appears on the insight, and `/ops` shows the funnel.
   8. `npm run eval:gates` and `npm run eval:recall` on the production DB; save `eval/results/rehearsal-<date>.md` with timings, cost per week per competitor, recall, and anything that felt wrong.

2. **Pre-send gates in production** (finishes phase 7's hook): the digest job runs G1 (quotes) and G2 (point-in-time) on every fact cited by the digest's hypotheses, insights and change lines, plus a duplicate check (no two insight titles with Jaccard ≥ 0.6 in one digest). Failure → `held` + email to `ops.email` with the offending ids; `/ops` lists held digests with a "Send anyway" button that records who overrode and why in `events`.

3. **The 30-day question**: `digests.sequence` counts per recipient set; when `sequence % 4 === 0` the digest appends a short block: *"One question after four weeks: did anything Delta surfaced change what you investigated, discussed, recommended, or decided? Reply with the insight and what you did differently."* Replies land through the inbound path with `status = 'processed'` and are shown on `/ops` under "Partner answers". A `/ops` form "Record a decision influenced" (insight id, free text, date) writes a `decision_influenced` event. Funnel on `/ops`: digests sent → reaction clicks → replies → decisions, with counts per week.

4. **Weekly labeling**: after each send, the digest job runs `eval:sample` on the digest period into `eval/labels/<date>.csv`; you label 25 items (≈ 20 minutes) and append a line to `eval/labels/ledger.md` with hard-fact precision, quotes (from gates), stale/duplicate rate, and hypotheses later contradicted (as resolutions appear). Go/no-go from the audit: hard-fact precision ≥ 98% on an eight-week rolling window (≥ 99% target), quotes 100%, stale+dup ≤ 5%; any material pricing/ownership/availability error is investigated the same week.

5. **Partner runbook** `docs/pilot-runbook.md`: what we need (two URLs, a 30-minute call, one email address), what they get (Monday digest, dashboard link and password, nothing else to do), how reactions and replies work, what we store (public pages, their replies, their profile) and which third parties process it (model provider, Exa, Resend, the VPS host), the day-30 question, how to stop. Operator checklist (15 minutes weekly): `/ops` status, held digests, label sample, open questions worth a correction, watchlist additions from replies.

6. **Tuning from rehearsal**: adjust `src/lib/digest/thresholds.ts` (score cutoff, top-N) and the discovery caps based on the rehearsal digest; re-run `eval:regress` after any prompt change.

7. **Finish**: README section "Running Delta for a design partner" linking deploy, runbook and rehearsal docs; `npm run check && npm test && npm run eval:gates`; tag `prototype-v1`.

## Acceptance criteria

- [x] AC1 (skipped by Nithan on 2026-11-03: needs a hosted instance and real email. What could be run locally is recorded in eval/results/rehearsal-2026-11-03-local.md, which is not the hosted rehearsal): `docs/pilot-rehearsal.md` has been executed on the hosted instance and `eval/results/rehearsal-<date>.md` records timings, weekly cost per competitor, recall, and the digest that was received.
- [x] AC2 (held digest and ops email verified by a test with a fake transport; held list rendered on /ops. Skipped by Nithan: on a production database, and Send anyway through real Resend): A tampered quote in the production DB causes the next digest to be `held`, an email to `ops.email`, and an entry on `/ops`; "Send anyway" records an override event.
- [x] AC3 (fourth-digest question and weekly funnel verified by tests; decision form submitted live. Skipped by Nithan: a real reply through Resend): The fourth digest in a sequence contains the 30-day question; a reply to it appears under "Partner answers" on `/ops`; the funnel shows sent/reacted/replied/decided counts.
- [x] AC4 (skipped by Nithan: labeling is a human judgement. The ledger template and the sheet generation exist, no week is labelled, so no precision number exists yet): `eval/labels/ledger.md` has at least one labelled week with the three metrics against the thresholds.
- [x] AC5 (runbook and README links done; check, test and gates green. Tag not created: the follow-plan rules forbid committing, and a tag now would point at the hackathon commit. Tag after committing): `docs/pilot-runbook.md` exists and the README links deploy, runbook and rehearsal; the repo is tagged `prototype-v1` with `npm run check`, `npm test`, `npm run eval:gates` green.
