# Models

Delta is model-agnostic. Every model call goes through one interface (`src/lib/llm/client.ts`) built on the [Vercel AI SDK](https://ai-sdk.dev) (`ai` 7.x), with two provider families:

| Provider key | Package | Reaches |
|---|---|---|
| `anthropic` | `@ai-sdk/anthropic` | Claude models on the Anthropic API |
| `openai` | `@ai-sdk/openai-compatible` | Any OpenAI-compatible endpoint: StepFun, OpenAI, OpenRouter, Groq, Ollama… |

## Roles

Models are chosen per **role**, not per call site:

| Role | Used by | Default | Effort default |
|---|---|---|---|
| `extract` | fact extraction per page, same-URL change detection | `anthropic:claude-haiku-5-5` | `low` |
| `synthesize` | synthesis (timeline, hypotheses, profile, questions) and insights | `anthropic:claude-opus-5-5` | `high` |

If no `ANTHROPIC_API_KEY` is set but an OpenAI-compatible key is, the defaults become `openai:step-3.7-flash` / `openai:step-5-preview` so an existing StepFun-only `.env.local` keeps working. When `OPENAI_COMPAT_BASE_URL` is `https://api.openai.com/v1` they become `openai:gpt-6-luna` / `openai:gpt-6.1-sol` instead.

## Configuration

```bash
LLM_EXTRACT=anthropic:claude-haiku-5-5     # provider:model
LLM_SYNTH=anthropic:claude-opus-5-5
LLM_EXTRACT_EFFORT=low                     # low | medium | high
LLM_SYNTH_EFFORT=high
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_COMPAT_BASE_URL=https://api.stepfun.ai/v1   # STEPFUN_BASE_URL still works
OPENAI_COMPAT_API_KEY=sk-...                        # STEPFUN_API_KEY still works
LLM_REASONING_EFFORT_MODELS=                        # extra OpenAI-compatible models that accept reasoning_effort
LLM_OPENAI_TEMPERATURE=0.2                          # OpenAI-compatible only
LLM_PRICES_JSON=                                    # {"model":{"input":$/M,"output":$/M,"cacheRead":…,"cacheWrite":…}}
```

Mixed setups are fine, e.g. `LLM_EXTRACT=openai:step-3.7-flash` with `LLM_SYNTH=anthropic:claude-opus-5-5`. `npm run llm:smoke` calls both roles and prints provider, model, tokens, cache reads and estimated cost.

## How a call works

`callJson({ task, role, system, user, schema, wire })` in `src/lib/llm/client.ts`:

1. `AiSdkClient` (`src/lib/llm/aiSdk.ts`) resolves the role's model and calls `generateText`.
   - **Anthropic**: the system prompt is sent as a system message with `cacheControl: { type: "ephemeral" }` (it is byte-stable per competitor, so the pages of a run share the cached prefix); `providerOptions.anthropic.effort` carries the role's effort; the strict `wire` schema goes to `Output.object` so the API constrains the JSON (`output_config.format`); no `temperature` (Claude 5.x rejects non-default sampling parameters); thinking is left at the model default (always on for Opus 5.5 / Haiku 5.5, controlled by effort).
   - **OpenAI-compatible**: `Output.json()` → `response_format: { type: "json_object" }`, `temperature` from config, and `reasoning_effort` only for models in the allow-list (`step-3.7-flash`, `gpt-6-luna` and `gpt-6.1-sol` by default). On OpenAI's own API, `max_tokens` is renamed to `max_completion_tokens` and no `temperature` is sent unless `LLM_OPENAI_TEMPERATURE` is set, because GPT-6 models return a 400 for `max_tokens` and for any temperature but the default (checked against the live API on 2026-11-03).
2. The response text is validated with the **lenient** Zod schema (`src/lib/pipeline/schemas.ts`), the single normalisation path for every provider (`"F12"` → `12`, bad enums → defaults, one malformed array item dropped instead of the whole response).
3. Invalid JSON or a schema mismatch retries once with the error appended; `finishReason === "length"` retries with double `maxOutputTokens`; a refusal (`content-filter`) throws `LlmError`, which skips that page during extraction.
4. Usage is recorded per role: `runs.stats.byRole.{extract,synthesize}` with prompt, completion, cache-read and cache-write tokens, plus `costUsd` from list prices (`src/lib/llm/pricing.ts`; unknown models show "n/a"). The run page and `/api/runs` expose it.

Strict wire schemas live in `src/lib/pipeline/wire.ts` (plain `z.object`/`z.enum`/`z.number().nullable()`; no `.catch`/`.transform`). Keep both schemas in sync when a prompt's output shape changes.

## Tracking spend

`/usage` (linked from `/ops`, behind the dashboard password) shows spend today, over 7 and 30 days and all time, split into AI and Exa, then by model, task and day, plus the latest calls. It reads `usage_events`, which has one row per paid call. `AiSdkClient` and the Exa client write those rows themselves, so onboarding, discovery, `doctor` and the eval scripts count as well as runs.

AI costs are tokens times list price at the time of the call, so swapping provider just works once the model has a price (`src/lib/llm/pricing.ts` or `LLM_PRICES_JSON`). Calls on a model with no known price are recorded with their tokens, and the page marks totals that exclude them with `+?`. Exa costs are what Exa reports in each response. A model request that fails outright has no usage to record. Mock-model runs are not recorded.

## Offline mode

`DELTA_MOCK_LLM=1` swaps in `MockLlmClient` (`src/lib/llm/mock.ts`), which derives canned JSON from the prompt text so verbatim-quote and id checks still pass. Tests set it automatically.

## Prompt rules that make the output trustworthy

- **Facts vs inference.** The extraction prompt forbids inferring intent; "Buffer lists an Agency plan at $120/month" is allowed, "Buffer is targeting agencies" is not. Inference happens only in synthesis, where every hypothesis update must cite fact ids.
- **Verbatim quotes, enforced in code.** Every fact carries a quote. `quoteIsVerbatim()` (`src/lib/pipeline/verbatim.ts`) normalizes whitespace and quote characters and requires an exact or ≥85% 3-word-shingle match against the page text. Non-verbatim facts are dropped and the drop is written to the run log.
- **Stable ids the model can cite.** Prior facts, hypotheses, questions and events are rendered as `F12`, `H3`, `Q2`, `E5`. Returned ids are validated against what was actually given; unknown ids are dropped with a warning in the run log.
- **Confidence moves with evidence.** The synthesis prompt caps per-run movement, forbids 1.0, and asks for alternative explanations and counter-evidence in `reasoning`.
- **Revision, not deletion.** When evidence contradicts a hypothesis and supports a better reading, the model emits `revised`; Delta retires the old row, inserts the new one with `supersedesId`, and both keep their update history.
- **User corrections are authoritative.** A correction stored on a hypothesis is injected into the next synthesis prompt as "USER CORRECTION (authoritative, must be respected)".
- **Diff-only change detection.** Two captures of the same URL are compared line-by-line in code first (`src/lib/pipeline/diff.ts`); only added/removed lines go to the model, and identical captures cost no call.

## History: measured StepFun usage (hackathon build, Oct 31 – Nov 1 2026)

The hackathon version used `step-3.7-flash` for extraction and `step-5-preview` for synthesis through StepFun's OpenAI-compatible endpoint. Numbers from the real Buffer replay:

| Run | Pages | Facts (+changes) | Hypothesis updates | Insights | Prompt tokens | Completion tokens | Wall time |
|---|---|---|---|---|---|---|---|
| Run 1 (≤ 2023-12-31) | 5 | 41 (+6) | 5 created | 3 | 46,356 | 65,435 | 323 s |
| Run 2 (≤ 2024-12-31) | 4 | 32 (+8) | 5 strengthened, 1 created | 4 | 45,723 | 71,739 | 296 s |
| Run 3 (≤ 2026-10-31) | 8 | 82 (+24) | 4 strengthened, 2 revised (+2 retired), 3 created | 4 | 105,408 | 124,526 | 537 s |

SocialPilot (8 real pages):

| Run | Pages | Facts (+changes) | Hypothesis updates | Insights | Prompt tokens | Completion tokens | Wall time |
|---|---|---|---|---|---|---|---|
| Run 1 (≤ 2023-12-31) | 3 | 21 (+6) | 5 created | 4 | 21,010 | 38,827 | 191 s |
| Run 2 (≤ 2024-12-31) | 1 | 11 (+6) | 2 revised (+2 retired), 1 strengthened | 3 | 13,480 | 24,922 | 157 s |
| Run 3 (≤ 2026-11-01) | 4 | 31 (+18) | 4 strengthened, 1 revised (+1 retired), 1 created | 4 | 42,542 | 74,566 | 288 s |

Completion tokens are high relative to prompt tokens because both models reason before answering; `reasoning_effort: low` was used for extraction to keep this in check.

## Files

- `src/lib/llm/client.ts` — `LlmClient` interface, `callJson()`, roles, usage helpers
- `src/lib/llm/aiSdk.ts` — the Vercel AI SDK adapter
- `src/lib/llm/providers.ts` — Anthropic and OpenAI-compatible model factories
- `src/lib/llm/config.ts` — `LLM_*` parsing, defaults, labels for the UI
- `src/lib/llm/pricing.ts` — list prices and cost estimates
- `src/lib/llm/mock.ts` — offline stand-in used by tests
- `src/lib/pipeline/wire.ts` — strict schemas for structured outputs; `schemas.ts` — lenient schemas
- `src/lib/pipeline/prompts/*.ts` — the four prompts
