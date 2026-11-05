# Delta — an AI competitive intelligence analyst

Delta continuously researches a competitor from its public pages, turns them into **facts with verbatim quotes**, connects the facts into **strategic hypotheses that get strengthened, contradicted and revised across runs**, and writes **insights and recommended actions for your company specifically**. It is model-agnostic: Claude (Anthropic) or any OpenAI-compatible model (StepFun, OpenAI, OpenRouter, Groq, Ollama) does the analytical work, chosen per role.

Built for the StepFun × NYU PMC Case Jam, Track 2 (Build with StepFun), Oct 30 – Nov 1, 2026.

## The demo story

Your company is **Loop**, a small social-media scheduling tool that sells to marketing agencies. The competitor is **Buffer**. The corpus is 18 real, unedited, dated Buffer pages (Wayback Machine captures and live pages), replayed in three runs where each run only sees pages dated on or before its cutoff:

| Run | Sees pages ≤ | What Delta finds |
|---|---|---|
| Run 1 | Dec 2023 | Agency plan at $120/mo, an agency landing page, agency case study → hypothesis: *Buffer is investing in agencies as a segment* |
| Run 2 | Dec 2024 | Agency plan cut to $100, support docs recommend it for 11+ channels, CEO note on per-channel "New Buffer" → **strengthened** |
| Run 3 | Oct 2026 | Agency plan gone from pricing, "last updated November 2025", yet an Agency Partner Program, "built for agencies" post and two agency case studies → the naive reading ("Buffer dropped agencies") is rejected: the segment hypothesis is **strengthened** to 0.85, "no partner program" is **retired and revised** into "hybrid PLG + 25%-commission partner program", "moving upmarket" is **revised** into "tiered per-channel pricing", and Run 1's open question about a partner program is **resolved** |

Every hypothesis update cites facts, every fact has a quote you can check against the source, and you can correct Delta's interpretation; the next run treats your correction as authoritative.

## Quick start

```bash
npm install
cp .env.example .env.local      # add ANTHROPIC_API_KEY (or an OpenAI-compatible key); optionally LLM_EXTRACT / LLM_SYNTH
npm run db:push                 # create data/delta.db
npm run seed                    # load Loop, Buffer, research questions and the 18 snapshots

# Option A: populated demo without any API call
npm run demo:restore
npm run dev                     # http://localhost:3000

# Option B: run the replay live (≈ 5 min per run with the real API)
npm run demo:fresh
npm run dev                     # then click "Run Run 1" on /c/buffer, or:
npm run run -- --competitor buffer --next
```

Other scripts: `npm run check` (tsc + eslint), `npm test` (vitest, offline with a mock model), `npm run corpus:fetch` (re-fetch the corpus from the manifest), `npm run package` (zip for submission), `npm run llm:smoke` (check the configured models), `npm run eval:gates` (deterministic trust gates on a database), `npm run eval:regress` (regression suite against the configured models; see `eval/`), `npm run eval:recall` and `npm run eval:sample`, `npm run crawl -- --competitor <slug> | --all` (re-fetch watched pages and poll feeds; configure the watchlist in Settings), `npm run discover -- --competitor <slug> [--since --until] [--absence]` (Exa discovery and absence checks), `npm run worker` (scheduler), `npm run digest -- --preview | --send`, `npm run backfill -- --competitor <slug> [--plan-only]` (24 months of Wayback history as backfill runs), `npm run doctor` (is this instance configured?).

## How it works

```
SourceProvider (seeded manifest | manual URL | watchlist | feeds | Exa discovery | Wayback backfill)
   → fetch (live or Wayback `id_` capture) → Readability → snapshot {url, source_type, published_at, fetched_at, raw_html, extracted_text, content_hash}
   → extract model (default claude-haiku-5-5): facts + verbatim quotes; same-URL change detection on a sentence diff
   → synthesize model (default claude-opus-5-5): timeline · hypotheses (created/strengthened/weakened/contradicted/revised) · strategy profile · open questions
   → synthesize model: insights (Observed / Inferred / Why it matters / Recommended) + respond/investigate actions
```

Nothing downstream can tell a seeded page from a live-fetched one; "Add URL" on the Evidence tab goes through the same pipeline and is analyzed in the next run. See [docs/models.md](docs/models.md) for the model roles, configuration, prompt rules and measured token usage, and [docs/demo-script.md](docs/demo-script.md) for the walkthrough.

## Running Delta for a design partner

Delta is built to send one partner a weekly digest about its real competitors with nothing required of them.

- [docs/deploy.md](docs/deploy.md): host it with Docker Compose (web, worker, Caddy), from a fresh VPS to the first digest.
- [docs/pilot-runbook.md](docs/pilot-runbook.md): what to ask the partner, what they get, what we store, and the 15-minute weekly operator checklist.
- [docs/pilot-rehearsal.md](docs/pilot-rehearsal.md): the dress rehearsal to run end to end before a real partner.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To add a data source or a model provider, see [docs/extending.md](docs/extending.md).

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · SQLite via Drizzle (`data/delta.db`) · Vercel AI SDK (`-sdk/anthropic`, `-sdk/openai-compatible`) · Readability + jsdom · Vitest. Runs locally with no deploy needed; [docs/deploy.md](docs/deploy.md) covers hosting it with Docker Compose.

## Repository map

- `src/lib/ingest/` — fetch, extract, snapshot, providers
- `src/lib/pipeline/` — extraction, diff, synthesis, insights, run orchestrator, prompts, schemas
- `src/lib/llm/` — model layer: roles, Vercel AI SDK adapter, provider config, pricing, offline mock
- `src/db/` — Drizzle schema and migrations in `drizzle/`
- `src/app/` — pages, server actions, `/api/runs` (NDJSON stream) and `/api/sources`
- `data/corpus/buffer/` — manifest and the 18 snapshot JSON files (the evidence)
- `data/demo/delta.demo.db` — pre-computed database with the three replay runs
- `docs/` — idea, plan phases, models, demo script, prototype plan (`docs/plans/`)

## Honest limitations

- Off-domain discovery needs an Exa key. Without one, sources are the watchlist, feeds, the 24-month backfill and URLs you add.
- Two competitors are seeded for the demo (Buffer with 18 pages, SocialPilot with 8). Onboarding adds real ones from their URLs.
- Historical pages are Wayback Machine captures; their `published_at` is the capture date, which is when the content was verifiably live.
- A full run against the real API takes several minutes (the reasoning models think); the shipped demo database exists so a presentation never depends on the network.

## License

Delta's code is under the [MIT license](LICENSE). The web pages captured in `data/` belong to their publishers and aren't covered by it.
