# Rehearsal record: 2026-11-03, local only

**This is not the dress rehearsal in `docs/pilot-rehearsal.md`.** That needs a VPS, DNS, a Resend account and a person. This records what was run for real on a development machine with Docker, and what is still unproven. Models were StepFun (`step-3.7-flash`, `step-5-preview`), because no Anthropic key was available.

## Run live and working

| Step | Result |
|---|---|
| Onboarding drafts | sendible.com: 7 pages read, all fields, 5 clarifying questions, 40 s. buffer.com as competitor: 10 watchlist pages including pricing and partners, 1 feed, 5 research questions, emphasis question, 46 s |
| Onboarding through the real forms | Draft, save and error paths submitted against the production build (mock model), rows confirmed in the database |
| Watchlist crawl (Buffer) | 4 pages checked, 2 changed; feed gave 15 new pages; repeat crawl within the interval checked nothing |
| Absence checks | Buffer partner program found at `/partners`; SocialPilot affiliate program found at `/affiliate`; topics with no page produced absence facts that G1 exempts |
| 24-month backfill (SocialPilot, 2 watched pages) | 8 cutoffs, 6 runs, 7 pages, 36 min 39 s. Every run saw only pages dated on or before its cutoff |
| Kill and resume | Killed mid-run from the CLI and with `kill -9` on the worker container. Both resumed immediately with no cutoff run twice |
| Worker | Heartbeat, backup, skip rule, overlap rejection, reschedule within 150 s; SIGTERM mid-run finished the run in 87 s and exited 0 |
| Docker Compose stack | Image builds from the lockfile; Caddy returns 401 on the dashboard and `/api/runs` without the password and 200 with it; `/r/*`, `/api/health`, `/about-bot` and webhooks are reachable without it; restore procedure works |
| Trust gates on the backfilled database | G1–G5 pass (58 quotes, 114 point-in-time checks, 112 id sets, 40 confidences, 42 citation sets) |

## Numbers

Backfill tokens, SocialPilot, 6 runs:

| Role | Input | Output |
|---|---|---|
| extract | 46,452 | 104,479 |
| synthesize | 64,294 | 119,823 |

At Haiku 5.5 and Opus 5.5 list prices that would be about **$2.71**. This is a rough estimate from StepFun token counts, since Claude's would differ. Cost per week per competitor on Claude has not been measured.

Recall on the backfilled database, SocialPilot only and with no discovery: **2 of 4** golden events. The two still missing are the group.one acquisition and the AI Pilot rename, both of which need discovery or a page outside the watchlist. On the demo database recall is 8 of 11 across both competitors.

## Found by rehearsing, not by tests

- **Pricing tables were being lost.** On pricing pages Readability settled on the FAQ and dropped the plan table: 0 of 54 prices kept on one SocialPilot capture. Later captures hashed identically, so real changes read as "unchanged". Fixed with a fallback to the full page text. The rerun captured 7 pages instead of 4, and recall went from 0 of 4 to 2 of 4. Three of the 26 corpus pages extract differently now. The shipped demo database still reflects the old text.
- **A crash blocked its own restart.** An orphaned running row made a resume fail with "already running" for 20 minutes. Fixed: a worker restart releases it and re-queues the job.
- **The lockfile broke fresh installs.** A lockfile made on Windows lacks Linux native binaries, and any lockfile makes npm try to compile `better-sqlite3`. Fixed by generating it in a clean directory and setting `ignore-scripts=true`.
- **Two build failures tests could not see.** A plain function exported from a `"use server"` file, and a client form importing the server-side model client.

## Added later the same day: OpenAI, Exa and Resend keys

Run on a copy of `data/delta.db` with `gpt-6-luna` (extract) and `gpt-6.1-sol` (synthesize).

| Step | Result |
|---|---|
| Discovery (SocialPilot, 2025-06-01 to 2025-08-31) | 54 candidates, 38 relevant, 16 rejected, 10 snapshots at the cap, 0 errors. Found the group.one acquisition, including group.one's own announcement. Exa $0.056, plus about $0.01 for the relevance model |
| Full run on those pages (17 pages, 187 facts, 4 insights) | Finished in 357 s for an estimated $0.24. G1 to G5 pass on the whole database |
| Recall on that copy | 10 of 11. SocialPilot 3 of 4, up from 2. Still missing: the April 2026 MCP server |
| Resend | Sent from `Delta <delta@mail.nithan.link>` to Resend's test inbox, accepted. Key is send-only |

Found this way: OpenAI's GPT-6 models return a 400 for `max_tokens` and for any temperature but the default. Both are now handled in the adapter. Also, all 10 discovery slots went to articles about one event while 28 relevant pages were dropped by the cap, so one big story can crowd out everything else that week.

## Not yet proven

- Anything on Claude models: structured outputs, prompt caching and real cost.
- Deliverability over several weeks, and the digest redesign in a real inbox.
- The Exa recall sweep across all quarters; only the one window above has run.
- `eval:regress` on the GPT models.
- A real VPS: public TLS, DNS, a nightly backup firing at 02:00, and a second person following `docs/deploy.md`.
- Human labeling: no precision number exists yet, so the audit's go/no-go bar has not been measured.

## Tuning notes for the real rehearsal

`TOP_INSIGHT_MIN_SCORE` (0.45) currently filters nothing: all 25 scored insights across two databases are between 0.56 and 0.96 (median about 0.8), so only the top-3 cap decides what appears. Scores skew high because the model rates its own relevance and actionability. Left unchanged, because there is no partner data to tune against. Look at this first after a real digest.
