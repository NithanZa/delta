# Delta MVP — initial thoughts (not yet a plan)

Written 2026-11-02, before the prototype was built. Purpose: capture the ranked thinking, the decisions already made, and the open questions so the MVP can be planned at any time after the prototype has run with a design partner. Expect adjustments: every item below should be re-ranked against what the partner actually did with the digests.

## Gates

- **Prototype** (planned in [`../prototype/`](../prototype/README.md)): one design partner receives a weekly digest about its real competitors for four weeks, hosted and paid for by Nithan, nothing required of the partner; the 30-day decision question is asked and the answer recorded.
- **MVP**: two or three partners run unattended for a quarter; a new partner is onboarded in under an hour without Nithan; outputs pass the trust gates every week; a stranger can self-host from the open-source repo.

## Ranked MVP items (by value to the partner)

1. **Self-serve onboarding and one-command deploy.** The prototype onboarding (phase 9) hardened so a stranger goes from clone to first digest in under an hour. Docker Compose plus a deploy template, env for model keys and the email provider, a first-run checklist, `npm run doctor`. One instance per company; still no auth layer.
2. **Trust gates running in production, with calibration.** The full harness from the audit's Part C: atomic fact precision on a rolling eight-week window, duplicate and stale rate, change-detection precision and recall against the golden timeline, and a digest that is held when a gate fails (prototype does the zero-tolerance subset). Hypothesis resolution: mark hypotheses true or false when later evidence settles them, then Brier score and reliability diagrams once about fifty are resolved. Targets from the audit: ≥ 0.80 hypotheses contradicted ≤ 10–15%, Brier ≤ 0.20, calibration error ≤ 0.10.
3. **Broader discovery.** Careers pages, G2 and Capterra, YouTube transcripts, Product Hunt, GitHub first (accessible, signal-rich). X and LinkedIn last (costly APIs, restrictive terms). Social was explicitly deferred from the prototype for this reason.
4. **Cross-competitor market view.** Synthesis across all of a partner's competitors ("three of four moved to per-seat pricing this year"). Needs explicit typed edges (`evidence_links`: supports / contradicts / supersedes / resolves / cites) instead of JSON id arrays on insights and events. This is where graph *modelling* earns its keep; see the Neo4j note below.
5. **Slack app and team-level feedback.** Reactions and replies inside Slack with identity from Slack rather than our own auth; a decision log recording which insight influenced which decision; shareable insight links. The prototype only posts to an incoming webhook.
6. **Correction and steering UX.** Edit, split, merge and retire hypotheses; pin or retire research questions; route a Wrong reaction into a factual review queue rather than a ranking penalty (the partner's own rule).
7. **Cost controls and routing.** Per-instance budget, Anthropic Batches API for extraction at half price, cheaper fallback model, cost line per run and per digest. Low partner value, high operator value.
8. **Export and agent access.** Strategy profile and timeline to Notion or Google Docs, CSV for the record, and a Model Context Protocol server so the partner's own agents can read the record (both demo competitors shipped MCP/API in 2026, a nice proof of demand).
9. **Postgres as an option, SQLite as default.** Only for self-hosters who want managed storage. Not a graph database.
10. **Open-source hygiene.** Plugin docs for the source-provider and model-client interfaces, the eval suite public so contributors cannot regress trust, contributing guide, regression suite in CI (prototype CI runs gates only; regression needs a funded key).

**Already done, ahead of the pilot (2026-11-04),** because no pilot answer could change them:

- Item 6: the Wrong review queue on `/ops`. Hypothesis editing and research-question pinning still wait.
- Item 7: spend per competitor, per run and per digest, and a monthly budget alert. Batches and a cheaper fallback model still wait on question 4.
- Item 10: an MIT license, a contributing guide and docs for the provider interfaces. Regression in CI still waits.

Discovery also now shares its page cap across stories and puts events first. Question 2 still decides the cap sizes and source order.

## Decisions already made (carry into MVP planning)

- Model-agnostic through the Vercel AI SDK (`ai` + `@ai-sdk/anthropic` + `@ai-sdk/openai-compatible`), chosen 2026-11-02 over a direct Anthropic SDK adapter; default Haiku 5.5 extraction, Opus 5.5 synthesis; StepFun selectable. Rough cost: a run was ~46k prompt + ~65k completion tokens on StepFun; on Opus 5.5 roughly $1.50 per run, so three partners × three competitors ≈ $15/week before discovery and backfill.
- Open source, no auth layer; hosted instances sit behind a proxy password; signed public links for reactions and webhooks.
- Discovery is both: watchlist re-crawl of own-domain pages (which would have caught four of the five audit recall misses) and Exa for off-domain news/press/reviews.
- Delivery is a weekly email digest; the dashboard is the drill-down.
- Partner never has to act; reactions and replies are optional and captured. Primary success signal: **at least one verified decision influenced within 30 days**, not dashboard engagement. Instrumented events: `insight_viewed`, `insight_reacted`, `insight_corrected`, `source_added`, `decision_influenced` (+ `digest_sent`, `reply_received`).
- Insight ranking weights: relevance 35%, novelty 25%, evidence 25%, actionability 15%. "Wrong" triggers factual review; do not overfit ranking to one partner's first clicks.
- Corrections are authoritative about the partner's own company only. Internal intelligence about a competitor is stored attributed ("per <sender>, internal"), moves confidence ≤ 0.1, never becomes public fact.
- Delta drafts the company profile from the partner's site and asks clarifying questions; drafts competitors from their sites and asks one emphasis question; 24 months of Wayback history is wanted.

## Notes on Neo4j, Exa and models

- **Neo4j: not yet, probably not for MVP.** The record is a graph in shape but small (hundreds of facts, dozens of hypotheses per competitor) and the pipeline loads the whole record per competitor anyway. Queries are "everything for this competitor" and one-hop lookups. Neo4j would cost zero-setup, open-source friendliness and the SQLite demo-restore trick. Take the graph model, not the graph database: add `evidence_links` in SQLite (MVP item 4). Revisit if the cross-competitor view needs multi-hop traversal across competitors.
- **Exa: yes, as the discovery provider** (prototype phase 8). It is neural search over embeddings, not graph search, which is the right tool here: date, domain and category filters, content retrieval, `costDollars` per call.
- **Models**: all current Claude models have a 1M context, so whole-record synthesis survives the swap; keep `PRIOR_FACT_CAP` for smaller OpenAI-compatible models. The audit's failure modes were prompt and schema problems more than model problems; expect model swaps to help less than the trust fixes.

## What the audit says to watch (2026-11-02, [`../../research/ground-truth-audit-2026-11-02.md`](../../research/ground-truth-audit-2026-11-02.md))

- Delta is better on strategic direction than on commercial-detail provenance. Fixed in the prototype: billing cadence collapsed into "price cut"; roadmap read as shipped; absence asserted without a check; conflicting official pages silently resolved; page removal read as discontinuation.
- Biggest recall misses: SocialPilot acquisition by group.one (2025-07-10), Buffer Community (2025-11-12), SocialPilot MCP server (2026-04-09), Buffer public API with MCP/CLI (2026-05-27), Buffer network additions (2024). The golden timeline in `eval/golden/` tracks them.
- Trust budget: quotes and temporal leakage are zero-tolerance; hard facts ≤ 1% wrong (block > 2%); stale/dupes ≤ 5%; hypotheses judged by calibration, not a flat error rate; empty digests are fine when true (false-empty ≤ 5%).
- Evaluation: keep facts, quotes, changes and hypotheses as different trust objects; never roll them into one accuracy number; automated LLM judges triage, humans arbitrate.

## Questions to answer with prototype data before planning the MVP

1. Did the partner react or reply at all? Which kinds? (Decides MVP items 5 and 6.)
2. Which sources produced the insights that were marked useful or acted on: watchlist, feed, discovery, backfill, internal? (Decides item 3's order and the discovery caps.)
3. How often was a digest quiet, and did the partner mind? (Decides thresholds and cadence.)
4. Weekly cost per competitor and the share spent on synthesis vs extraction vs discovery. (Decides item 7.)
5. Which trust gate fired, if any, and what the labelled precision was over the four weeks. (Decides how much of item 2 is needed before a second partner.)
6. Did anyone ask for a cross-competitor view, an export, or Slack-native use? (Decides items 4, 5, 8.)
7. How long did onboarding take with the partner on the call, and which clarifying questions were useless? (Decides item 1.)
