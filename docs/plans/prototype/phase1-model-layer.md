# Delta prototype

## Outcome

The pipeline runs unchanged on two provider families behind one interface, built on the **Vercel AI SDK** (`ai` 7.x): **Anthropic** (`@ai-sdk/anthropic`: structured outputs, prompt caching, effort) and **OpenAI-compatible** (`@ai-sdk/openai-compatible`: StepFun, OpenAI, OpenRouter, Groq, Ollama). Models are chosen per *role* from env: `extract` (fact extraction and change detection) and `synthesize` (synthesis and insights). The default is `anthropic:claude-haiku-5-5` for `extract` and `anthropic:claude-opus-5-5` for `synthesize`; `openai:step-3.7-flash` / `openai:step-5-preview` still work and are the automatic fallback when only a StepFun key is configured. Every run records tokens per role, cache reads, and an estimated cost. Tests still run offline against the mock.

*Revised 2026-11-02: Nithan asked for the Vercel AI SDK instead of the direct Anthropic SDK + `openai` SDK adapters originally planned. The role/config/wire/pricing design is unchanged; only the adapter layer differs.*

## Step-by-step

1. **Prerequisites.** `npm install` (the working tree has no `node_modules/next`). Confirm `node_modules/next/dist/docs/` exists and skim the route-handler and server-functions guides; nothing in this phase touches `src/app` except labels. Add `ai@^7`, `@ai-sdk/anthropic@^4`, `@ai-sdk/openai-compatible@^3` to dependencies and remove `openai` (no longer imported). Node 22.17 satisfies Next 16's ≥ 20.9 requirement.

2. **Move the client out of `stepfun/`.** Create `src/lib/llm/` and move `src/lib/stepfun/client.ts` → `src/lib/llm/client.ts`, `src/lib/stepfun/mock.ts` → `src/lib/llm/mock.ts`, `src/lib/stepfun/client.test.ts` → `src/lib/llm/client.test.ts`. Update imports in `src/lib/pipeline/extract.ts`, `synthesize.ts`, `run.ts`, their tests, and `scripts/`. Delete `src/lib/stepfun/`. Keep `callJson()`'s signature so pipeline code barely changes.

3. **Roles instead of model names.** In `client.ts` replace `MODELS.fast/deep` with `type LlmRole = "extract" | "synthesize"`. `LlmRequest` becomes `{ task, role, system, user, maxTokens?, effort?: "low"|"medium"|"high", wire?: ZodType }`. Drop `temperature` and `reasoningEffort` from the interface (Claude 5.x models return 400 on non-default sampling parameters; the OpenAI-compatible path sets temperature from config and `reasoning_effort` from a per-model flag). `callJson({ role, schema, wire, ... })` resolves the model through the single `AiSdkClient`; default `maxTokens` 8192 for `extract`, 16000 for `synthesize`.

4. **Config.** `src/lib/llm/config.ts` parses `LLM_EXTRACT` and `LLM_SYNTH` in the form `provider:model` (`anthropic:claude-haiku-5-5`, `openai:step-3.7-flash`; aliases `claude`, `stepfun`, `openai-compatible`). Provider credentials: `ANTHROPIC_API_KEY`; `OPENAI_COMPAT_BASE_URL` + `OPENAI_COMPAT_API_KEY` (fall back to `STEPFUN_BASE_URL`/`STEPFUN_API_KEY` so existing `.env.local` files keep working; when only that key exists and no `LLM_*` is set, the StepFun models become the defaults). Per-role effort: `LLM_EXTRACT_EFFORT` (default `low`), `LLM_SYNTH_EFFORT` (default `high`). Per-model flag `supportsReasoningEffort` for OpenAI-compatible models (true for `step-3.7-flash`; extend with `LLM_REASONING_EFFORT_MODELS`). `LLM_OPENAI_TEMPERATURE` (default 0.2). Update `src/lib/env.ts` and `.env.example`.

5. **Wire schemas for structured outputs.** The existing Zod schemas in `src/lib/pipeline/schemas.ts` use `.catch()`, `.transform()` and `number|string` unions to tolerate sloppy JSON. Structured outputs need a plain JSON-schema-compatible shape. Add `src/lib/pipeline/wire.ts` with strict mirrors (`ExtractFactsWire`, `ChangeWire`, `SynthesisWire`, `InsightsWire`: `z.object` with `z.enum`, `z.number().nullable()`, `z.array(z.number())`, no transforms). Every `callJson` call passes both `schema` (lenient, used to validate and normalise) and `wire` (strict, handed to `Output.object` on Anthropic). The lenient parse remains the single normalisation path for all providers, so `"F12"` → `12` behaves identically everywhere.

6. **Provider factory** `src/lib/llm/providers.ts`: `createLanguageModel(role, config)` returns an AI SDK `LanguageModel` — `createAnthropic({ apiKey })(model)` or `createOpenAICompatible({ name: "openaiCompat", baseURL, apiKey })(model)`; throws a clear error when the provider's key is missing.

7. **One adapter** `src/lib/llm/aiSdk.ts` (`AiSdkClient implements LlmClient`, shape in *API notes*): `generateText` with `maxRetries: 3`, `timeout: 600_000` (ms), `maxOutputTokens` from the request.
   - Anthropic: `instructions` is a system message carrying `providerOptions.anthropic.cacheControl = { type: "ephemeral" }` so the per-competitor system prompt is cached across the pages of a run; `providerOptions.anthropic.effort` from the role; `output: Output.object({ schema: wire })` (→ `output_config.format`); no `temperature`; omit `thinking` (always on for Opus 5.5 / Haiku 5.5).
   - OpenAI-compatible: `output: Output.json()` (→ `response_format: { type: "json_object" }`), `temperature` from config, `providerOptions.openaiCompat.reasoningEffort` only when the model flag allows it.
   - Map `finishReason`: `length` → `truncated: true` (existing retry doubles the budget); `content-filter` (Anthropic `refusal`) → throw `LlmError("refusal…")` (extraction already skips a page whose call throws). `NoObjectGeneratedError` (the SDK could not parse structured output) → return its `text` so the existing retry with the error appended applies. Usage → `{ promptTokens: usage.inputTokens, completionTokens: usage.outputTokens, cacheReadTokens: usage.inputTokenDetails.cacheReadTokens, cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens }`.

8. **Pricing and stats.** `src/lib/llm/pricing.ts`: USD per million tokens, overridable by `LLM_PRICES_JSON`. Seed values (Anthropic list prices, cached 2026-10-06 in the Claude API reference): `claude-haiku-5-5` 0.10 in / 0.50 out (prompts ≤ 100k tokens); `claude-opus-5-5` 4.00 / 20.00, cache read 0.20; `claude-sonnet-5-5` 2.00 / 10.00, cache read 0.20; cache writes ≈ 1.25× input. Unknown models → `null` (UI shows "n/a"). Extend `RunStats` with `byRole: Record<LlmRole, Usage>`, `cacheReadTokens`, `cacheWriteTokens`, `models` and `costUsd`; `addUsage()` in `run.ts` records per role. Run detail page (`src/app/c/[slug]/runs/[id]/page.tsx`) shows cost, cache reads and the models used.

9. **Labels.** `src/components/run-panel.tsx` and `src/app/layout.tsx` hard-code StepFun model names. Expose the configured labels through a tiny server helper (`getModelLabels()` in `src/lib/llm/config.ts`) passed as props from `src/app/c/[slug]/page.tsx`; the footer reads it in `layout.tsx`.

10. **Smoke script** `scripts/llm-smoke.ts` (`npm run llm:smoke`): calls both roles with a two-field schema and prints provider, model, tokens, cache read tokens, and cost.

11. **Tests.** `config.test.ts` (parsing, defaults, fallback, bad input). `aiSdk.test.ts` with `MockLanguageModelV4` from `ai/test` injected per role covering: success with cache usage mapping, `length` truncation, `content-filter` refusal, unparsable text handed back for retry, effort override, and the OpenAI-compatible request shape (JSON mode, temperature, `reasoningEffort` only for allow-listed models). Existing `callJson` tests move with `role` added. `npm test`, `npm run check`.

12. **Docs.** Rename `docs/stepfun-integration.md` → `docs/models.md`: roles, providers, config, caching, cost; keep the measured StepFun tables as history. Update README "Stack", "How it works", quick start and repository map (`LLM_EXTRACT`/`LLM_SYNTH`, `src/lib/llm/`).

## API notes (verified 2026-11-02 against ai-sdk.dev and the installed packages)

**Packages** (npm, 2026-11-02): `ai` 7.0.162, `@ai-sdk/anthropic` 4.0.96, `@ai-sdk/openai-compatible` 3.0.84; all peer-depend on `zod ^3.25.76 || ^4.1.8` (we have 4.6.7).

**`generateText` (ai 7)** — reference: ai-sdk.dev/docs/reference/ai-sdk-core/generate-text and the 7.0 migration guide.

```ts
import { generateText, Output, NoObjectGeneratedError, type LanguageModel } from "ai";

const result = await generateText({
  model,                                   // LanguageModel from a provider factory
  instructions: [                          // `system` is a deprecated alias; a string is also accepted
    { role: "system", content: SYSTEM, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } },
  ],
  prompt: USER,                            // string, or ModelMessage[]
  maxOutputTokens: 16000,
  maxRetries: 3,                           // default 2; retries 408/409/429/5xx + network errors
  timeout: 600_000,                        // ms; number or { totalMs, stepMs, toolMs }
  temperature: 0.2,                        // omit on Claude 5.x
  output: Output.object({ schema }),       // or Output.json() (JSON mode, no schema) or Output.text()
  providerOptions: { anthropic: { effort: "high" } },
});
result.text;                               // concatenated text of the final step (the JSON for structured outputs)
result.output;                             // parsed + validated object (getter; throws NoOutputGeneratedError if none)
result.finishReason;                       // 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'interrupted' | 'other'
result.rawFinishReason;                    // provider value, e.g. "max_tokens" / "refusal"
result.usage.inputTokens; result.usage.outputTokens; result.usage.totalTokens;
result.usage.inputTokenDetails.cacheReadTokens; result.usage.inputTokenDetails.cacheWriteTokens; // .noCacheTokens
result.usage.outputTokenDetails.reasoningTokens;
result.finalStep.providerMetadata;         // top-level providerMetadata/response are deprecated in 7.x
```

- `experimental_output` and the top-level `cachedInputTokens`/`reasoningTokens` fields were removed in 7.0; `system` → `instructions`; system messages inside `messages` need `allowSystemInMessages: true`.
- `NoObjectGeneratedError.isInstance(e)` with `e.text`, `e.usage`, `e.finishReason`, `e.cause` when the output cannot be parsed/validated. `NoOutputGeneratedError` when `output` is read but none exists.
- The top-level `reasoning` option (`'low'|'medium'|'high'|'xhigh'|'max'|…`) is the provider-agnostic effort control; provider-specific settings in `providerOptions` take precedence, so we set `providerOptions.anthropic.effort` / `providerOptions.openaiCompat.reasoningEffort` explicitly and leave `reasoning` unset.

**`@ai-sdk/anthropic` 4.0.96** — reference: ai-sdk.dev/providers/ai-sdk-providers/anthropic.

```ts
import { createAnthropic } from "@ai-sdk/anthropic";
const anthropic = createAnthropic({ apiKey });   // defaults to ANTHROPIC_API_KEY; baseURL, headers, authToken, fetch optional
const model = anthropic("claude-opus-5-5");       // "claude-haiku-5-5", "claude-sonnet-5-5" …
```

- `providerOptions.anthropic`: `effort: "low"|"medium"|"high"|"xhigh"|"max"` (→ `output_config.effort`); `thinking: { type: "adaptive" | "enabled" | "disabled" | "between_tools" }` (omit on Opus 5.5 / Haiku 5.5: thinking is always on, effort is the only lever; `disabled` is a 400 there); `cacheControl: { type: "ephemeral", ttl?: "5m"|"1h" }` on a system message, message part or tool (max 4 breakpoints); `structuredOutputMode: "outputFormat"|"jsonTool"|"auto"` (default `auto`; `jsonTool` is unusable on Opus 5.5 / Sonnet 5.5 / Fable 5.1 because forced tool use is rejected, the provider falls back to `outputFormat`); `fallbacks: "default"`, `anthropicBeta: [...]`, `safeguards`, `taskBudget`, `speed`, `inferenceGeo` also exist (unused here).
- Finish-reason mapping in the provider: `end_turn` → `stop`, `max_tokens` → `length`, `refusal` → `content-filter`.
- Usage: provider reports `inputTokens.total = input + cache_creation + cache_read`, so `usage.inputTokens` is the whole prompt and the cache parts are subsets (pricing subtracts them). Cache usage shows up in `usage.inputTokenDetails.cacheReadTokens/cacheWriteTokens`; prompts shorter than the model's minimum (1024–4096 tokens depending on model) silently don't cache.
- Schemas with recursive references, open maps, or more than ten optional properties fall back to the JSON tool; the wire schemas avoid all three.

**`@ai-sdk/openai-compatible` 3.0.84** — reference: ai-sdk.dev/providers/openai-compatible-providers.

```ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
const provider = createOpenAICompatible({ name: "openaiCompat", baseURL: "https://api.stepfun.ai/v1", apiKey });
const model = provider("step-3.7-flash");         // = provider.chatModel(id) = provider.languageModel(id)
```

- `providerOptions[<name>]` (and its camelCase form) is spread into the request body: documented keys `reasoningEffort` (sent unchanged as `reasoning_effort`), `user`, `textVerbosity`, `strictJsonSchema`; unknown keys pass through verbatim.
- `Output.json()` → `response_format: { type: "json_object" }`; `Output.object({ schema })` → `json_schema` only when `supportsStructuredOutputs: true` is set on the provider (StepFun is not known to support it, so we use JSON mode plus the lenient parse).
- Finish-reason mapping: `stop` → `stop`, `length` → `length`, `content_filter` → `content-filter`, else `other`. Usage comes from `usage.prompt_tokens/completion_tokens` (`includeUsage: true` only matters for streaming).

**Tests**: `import { MockLanguageModelV4 } from "ai/test"`; `new MockLanguageModelV4({ provider, modelId, doGenerate })` where `doGenerate` is a function or a canned `{ content: [{ type: "text", text }], finishReason: { unified: "stop"|"length"|"content-filter"|…, raw }, usage: { inputTokens: { total, noCache, cacheRead, cacheWrite }, outputTokens: { total, text, reasoning } }, warnings: [] }`; `model.doGenerateCalls[i]` exposes `prompt`, `providerOptions`, `maxOutputTokens`, `temperature`, `responseFormat`.

## Acceptance criteria

- [x] AC1 (skipped by Nithan on 2026-11-02: no Anthropic key available; StepFun path verified instead): With `LLM_EXTRACT=anthropic:claude-haiku-5-5 LLM_SYNTH=anthropic:claude-opus-5-5`, `npm run demo:fresh && npm run run -- --competitor buffer --next` completes Run 1 with `status = done`; `runs.stats` contains `byRole.extract`, `byRole.synthesize`, `costUsd > 0`, and `cacheReadTokens > 0` for the extract role.
- [x] AC2: With `LLM_EXTRACT=openai:step-3.7-flash LLM_SYNTH=openai:step-5-preview` the same command completes (StepFun path intact).
- [x] AC3: `npm test` passes offline; `grep -r "lib/stepfun" src scripts` returns nothing; the adapter tests cover truncation, refusal and unparsable output.
- [x] AC4: `npm run llm:smoke` prints both roles' provider, model, token usage and cost without error.
- [x] AC5: The run panel stage labels and the layout footer show the configured model ids, not hard-coded StepFun names.
- [x] AC6: `npm run check` passes; `docs/models.md` and `.env.example` document `LLM_EXTRACT`, `LLM_SYNTH`, effort and credential variables.
