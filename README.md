# Delta — an AI competitive intelligence analyst

Delta continuously researches a competitor from its public pages, turns them into **facts with verbatim quotes**, connects the facts into **strategic hypotheses that get strengthened, contradicted and revised across runs**, and writes **insights and recommended actions for your company specifically**. StepFun models do all of the analytical work.

Built for the StepFun × NYU PMC Case Jam, Track 2 (Build with StepFun), Oct 30 – Nov 1, 2026.

## The demo story

Your company is **Loop**, a small social-media scheduling tool that sells to marketing agencies. The competitor is **Buffer**. The corpus is 18 real, unedited, dated Buffer pages (Wayback Machine captures and live pages), replayed in three runs where each run only sees pages dated on or before its cutoff:

| Run | Sees pages ≤ | What Delta finds |
|---|---|---|
| Run 1 | Dec 2023 | Agency plan at $120/mo, an agency landing page, agency case study → hypothesis: *Buffer is investing in agencies as a segment* |
| Run 2 | Dec 2024 | Agency plan cut to $100, support docs recommend it for 11+ channels, CEO note on per-channel "New Buffer" → **strengthened** |
| Run 3 | Oct 2026 | Agency plan gone from pricing, "last updated November 2025", yet an Agency Partner Program, "built for agencies" post and two agency case studies → **contradicted and revised**: agencies are served through per-channel Team pricing and a partner channel, not a dedicated tier |

Every hypothesis update cites facts, every fact has a quote you can check against the source, and you can correct Delta's interpretation; the next run treats your correction as authoritative.

## Quick start

```bash
npm install
cp .env.example .env.local      # add your StepFun API key
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

Other scripts: `npm run check` (tsc + eslint), `npm test` (vitest, offline with a mock model), `npm run corpus:fetch` (re-fetch the corpus from the manifest), `npm run package` (zip for submission).

## How it works

```
SourceProvider (seeded manifest | manual URL | search — stub)
   → fetch (live or Wayback `id_` capture) → Readability → snapshot {url, source_type, published_at, fetched_at, raw_html, extracted_text, content_hash}
   → step-3.7-flash: facts + verbatim quotes; same-URL change detection on a sentence diff
   → step-5-preview: timeline · hypotheses (created/strengthened/weakened/contradicted/revised) · strategy profile · open questions
   → step-5-preview: insights (Observed / Inferred / Why it matters / Recommended) + respond/investigate actions
```

Nothing downstream can tell a seeded page from a live-fetched one; "Add URL" on the Evidence tab goes through the same pipeline and is analyzed in the next run. See [docs/stepfun-integration.md](docs/stepfun-integration.md) for the model roles, prompt rules and measured token usage, and [docs/demo-script.md](docs/demo-script.md) for the walkthrough.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · SQLite via Drizzle (`data/delta.db`) · `openai` SDK pointed at `api.stepfun.ai` · Readability + jsdom · Vitest. Local-first, no auth, no deploy needed.

## Repository map

- `src/lib/ingest/` — fetch, extract, snapshot, providers
- `src/lib/pipeline/` — extraction, diff, synthesis, insights, run orchestrator, prompts, schemas
- `src/lib/stepfun/` — StepFun client (JSON mode + Zod + retry) and the offline mock
- `src/db/` — Drizzle schema (13 tables) and migrations in `drizzle/`
- `src/app/` — pages, server actions, `/api/runs` (NDJSON stream) and `/api/sources`
- `data/corpus/buffer/` — manifest and the 18 snapshot JSON files (the evidence)
- `data/demo/delta.demo.db` — pre-computed database with the three replay runs
- `docs/` — idea, plan phases, approach, StepFun integration, demo script

## Honest limitations

- No search provider yet: sources are the curated manifest plus URLs you add. `SearchProvider` is the extension point.
- One competitor is seeded. The schema and UI support many.
- Historical pages are Wayback Machine captures; their `published_at` is the capture date, which is when the content was verifiably live.
- A full run against the real API takes several minutes (the reasoning models think); the shipped demo database exists so a presentation never depends on the network.
