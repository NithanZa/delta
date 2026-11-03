# Delta prototype — plan index

Planned 2026-11-02 from the hackathon PoC on `master` (commit `41a9dad`). The MVP is deliberately **not** planned yet; the ranked thinking for it lives in [`../mvp/initial-mvp-thoughts.md`](../mvp/initial-mvp-thoughts.md) and will be turned into phases after this prototype has run with a design partner.

## The prototype gate

One design-partner B2B SaaS startup receives a weekly digest about its real competitors for four consecutive weeks, hosted and paid for by Nithan, with nothing required of the partner. After the fourth digest we can ask: *"Did anything Delta surfaced this month change what you investigated, discussed, recommended, or decided?"* and record the answer.

## Decisions this plan is built on

| Decision | Source |
|---|---|
| Model-agnostic via the Vercel AI SDK: Anthropic and OpenAI-compatible providers, per-role models; default Haiku 5.5 for extraction, Opus 5.5 for synthesis; StepFun stays selectable | brainstorm 2026-11-02 |
| Open source, no auth layer; the hosted dashboard sits behind a reverse-proxy password; reaction links and webhooks are public and signed | brainstorm |
| Watchlist re-crawl of the competitor's own pages **and** off-domain discovery (Exa) | brainstorm |
| Weekly email digest first, Slack webhook optional; dashboard is the drill-down | brainstorm |
| Partner never has to do anything; reactions (useful / wrong / acted on) and email replies are optional and captured | brainstorm |
| Corrections are authoritative about the partner's own company only; internal intelligence about a competitor is stored *attributed*, never promoted to public fact | brainstorm |
| Delta drafts the company profile from the partner's site and asks clarifying questions; drafts competitor profiles from their sites; 24 months of Wayback history | brainstorm |
| Trust fixes come before features: the audit in [`../../research/ground-truth-audit-2026-11-02.md`](../../research/ground-truth-audit-2026-11-02.md) found billing-cadence, roadmap-vs-shipped, absence-claim and conflict errors; quotes and cutoff leakage are zero-tolerance | audit |

## Phases (dependency order)

| # | File | One line |
|---|---|---|
| 1 | [phase1-model-layer.md](phase1-model-layer.md) | Provider-agnostic LLM layer on the Vercel AI SDK (Anthropic + OpenAI-compatible), per-role models, structured outputs, caching, cost accounting |
| 2 | [phase2-eval-harness.md](phase2-eval-harness.md) | Deterministic trust gates, regression suite encoding the audit's failure modes, golden timeline for recall, labeling sampler, CI |
| 3 | [phase3-trust-fixes.md](phase3-trust-fixes.md) | Billing cadence, availability, absence claims, conflicts, page-removal wording, point-in-time guard; regression goes green |
| 4 | [phase4-watchlist-crawler.md](phase4-watchlist-crawler.md) | Watchlist re-crawl of own-domain pages plus RSS/Atom/sitemap pollers; Settings UI |
| 5 | [phase5-scheduler-worker.md](phase5-scheduler-worker.md) | Worker process with cron schedules, job queue, run kinds, skip-when-nothing-new, `/ops` page |
| 6 | [phase6-insight-ranking.md](phase6-insight-ranking.md) | Insight dedupe across runs, relevance scoring, "since last digest" content model |
| 7 | [phase7-digest-and-feedback.md](phase7-digest-and-feedback.md) | Resend email digest, signed reaction links, inbound reply capture → attributed internal intel, optional Slack, instrumentation events |
| 8 | [phase8-discovery.md](phase8-discovery.md) | Exa-backed off-domain discovery, relevance gate, absence checks, recall measurement |
| 9 | [phase9-onboarding.md](phase9-onboarding.md) | Company and competitor drafts from URLs, clarifying questions, watchlist and research-question proposals |
| 10 | [phase10-backfill.md](phase10-backfill.md) | 24-month Wayback backfill at quarterly cutoffs as resumable backfill runs |
| 11 | [phase11-deployment.md](phase11-deployment.md) | Docker Compose (web + worker + Caddy), volume, backups, health, public URL, env |
| 12 | [phase12-pilot-readiness.md](phase12-pilot-readiness.md) | Dress rehearsal, pre-send gates, 30-day question, labeling cadence, partner runbook, tag `prototype-v1` |

## Conventions for every phase

- **Next.js 16 docs first.** `node_modules/next` is currently missing from the working tree; run `npm install`, then read the relevant guide in `node_modules/next/dist/docs/` before writing anything under `src/app` (route handlers, server functions, `after`, proxy). Key facts verified against nextjs.org on 2026-11-02: `params`/`searchParams` are Promises; route handlers export `GET`/`POST` taking a Web `Request`, read raw bodies with `request.text()`; `after()` from `next/server` runs work after the response and is supported with `next start` and Docker; `revalidateTag` now needs a second `cacheLife` argument and `updateTag` gives read-your-writes in server actions; `middleware.ts` is renamed `proxy.ts` (we do not need one); `next lint` is gone (`npm run lint` already calls ESLint directly).
- **Schema changes** go through `npx drizzle-kit generate --name <slug>`; `createDb()` migrates on open, so `npm run db:push` and tests pick migrations up automatically. Update `src/db/schema.test.ts`'s table list every time.
- **Tests** stay offline (`DELTA_MOCK_LLM=1`, in-memory SQLite). Anything that needs the network gets a `fetchImpl` injection like `fetchPage` already has.
- **API notes** sections quote the exact shapes verified on 2026-11-02 against the vendors' own docs. If a vendor page disagrees with the note at implementation time, the vendor page wins; update the note.
- **Done means** `npm run check`, `npm test` and `npm run eval:gates` pass, and the phase's acceptance criteria are ticked in the file.
- Package versions confirmed on npm on 2026-11-02: `ai` 7.0.162, `@ai-sdk/anthropic` 4.0.96, `@ai-sdk/openai-compatible` 3.0.84 (all peer `zod ^3.25.76 || ^4.1.8`, we have 4.6.7; the Vercel AI SDK replaced the direct `@anthropic-ai/sdk` plan on 2026-11-02 at Nithan's request), `resend` 6.37.0 (node ≥ 20), `croner` 11.0.0, `fast-xml-parser` 5.11.2, `next` 16.4.x.
