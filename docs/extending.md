# Extending Delta

Delta has two extension points: where pages come from (`SourceProvider`) and which model reads them (`LlmClient`).

## Add a data source

A source provider proposes pages. It doesn't fetch or store them. The interface is in `src/lib/ingest/providers.ts`:

```ts
export interface SourceProvider {
  readonly id: Provider;
  discover(competitor: Pick<Competitor, "slug" | "website">): Promise<SourceCandidate[]>;
}
```

`SourceCandidate` needs a `url`, a `sourceType` and a `provider`. These optional fields improve the results:

| Field | Why it matters |
|---|---|
| `publishedAt` | Decides which runs can see the page. Without it, a page can't be placed correctly on the timeline. |
| `text` | Page text you already have, used when Delta's own fetch fails. |
| `score` | Your ranking, higher first. Discovery uses it to order stories when the page cap applies. |
| `title`, `note` | Shown as evidence. `note` records the query that found the page. |

To add one:

1. Add your provider's id to `PROVIDERS` in `src/db/schema.ts`.
2. Implement the interface. `SeededProvider` is the simplest example and `SearchProvider`, which uses Exa, is the fullest.
3. Pass any HTTP client in as an option, as `SearchProvider` does with `fetchImpl`, so that tests can run offline.
4. Send pages through `createSnapshot` in `src/lib/ingest/snapshot.ts`. It de-duplicates by content, and after that nothing downstream can tell where a page came from.

Off-domain results should also go through the relevance gate and the page cap in `discoverCompetitor` (`src/lib/ingest/discovery.ts`), which stops low-value pages from costing money later in the pipeline.

Respect each site's terms and robots rules. Social networks are blocked by default through the `discovery.blockedDomains` setting.

## Add a model provider

For most models you don't need any code. Any OpenAI-compatible endpoint works through configuration, and [models.md](models.md) covers the settings:

```bash
OPENAI_COMPAT_BASE_URL=https://openrouter.ai/api/v1
LLM_EXTRACT=openai:some-small-model
LLM_SYNTH=openai:some-large-model
```

Add `LLM_PRICES_JSON` so that `/usage` and the budget alert can price the calls. Calls with no known price are recorded, but they make those totals too low.

To support a provider that isn't OpenAI-compatible, use its Vercel AI SDK package inside `src/lib/llm/aiSdk.ts`, never the vendor's own SDK. Every model call goes through one small interface in `src/lib/llm/client.ts`:

```ts
export interface LlmClient {
  complete(req: LlmRequest): Promise<LlmResponse>;
}
```

`aiSdk.ts` also records each call's usage, which is what keeps the spend figures complete. A custom client has to do the same by calling `recordUsage`.

Before relying on a new model, check it against real cases:

```bash
npm run llm:smoke      # does each role respond?
npm run eval:regress   # does it still avoid the mistakes the audit found?
```

A model that passes the smoke test can still fail the regression suite, so run both.

## Add a pipeline task

Each model call has a `task`, such as `assess_relevance`. If you add one:

1. Add it to `LlmTask` in `src/lib/llm/client.ts`.
2. Add a default handler to `MockLlmClient` in `src/lib/llm/mock.ts`, so that offline tests keep working.
3. Add it to `STAGE_BY_TASK` in `src/lib/usage.ts`. Otherwise `/usage` counts its spend as "Other".
