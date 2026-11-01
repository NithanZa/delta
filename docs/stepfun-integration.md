# How Delta uses StepFun models

Delta's analytical work is done entirely by two StepFun models reached through the OpenAI-compatible endpoint at `https://api.stepfun.ai/v1`. No other model provider is used.

| Stage | Model | Why this model | Calls per run |
|---|---|---|---|
| Fact extraction (per page) | `step-3.7-flash` | Fast, cheap, JSON mode, `reasoning_effort: low`. Each page is an independent job, so cost and latency matter more than cross-document reasoning. | 1 per new page |
| Change detection (same URL, two captures) | `step-3.7-flash` | Receives only the sentence-level diff between two captures. Small input, precise output. | 1 per page that has an earlier capture with different content (0 if identical) |
| Synthesis: timeline, hypotheses, strategy profile, open questions | `step-5-preview` | 1M-token context. Receives *everything Delta already believes* (all prior facts with ids, hypotheses with history and user corrections, timeline, open questions) plus the new facts, and must reason across sources and time. | 1 |
| Insights and recommended actions | `step-5-preview` | Needs the company profile, priorities and constraints together with the updated hypotheses to decide what matters *to this company* and what is realistic. | 1 |

## The pipeline

```
snapshot (seeded page or live URL)
  └─ step-3.7-flash → facts [{statement, quote, category, eventDate, importance}]
  └─ step-3.7-flash → changes vs previous capture of the same URL (diff only)
        ↓ verbatim-quote check drops any fact whose quote is not in the page
step-5-preview → timeline events · hypothesis updates (created / strengthened / weakened /
                 contradicted / revised / retired, each with confidence delta, reasoning and fact ids)
               · strategy profile (5 dimensions with confidence and fact ids)
               · open questions resolved / raised
step-5-preview → insights: Observed · Inferred · Why it matters to <company> · Recommended
                 + actions typed respond | investigate, citing hypothesis ids and fact ids
```

## Prompt rules that make the output trustworthy

- **Facts vs inference.** The extraction prompt forbids inferring intent; "Buffer lists an Agency plan at $120/month" is allowed, "Buffer is targeting agencies" is not. Inference happens only in synthesis, where every hypothesis update must cite fact ids.
- **Verbatim quotes, enforced in code.** Every fact carries a quote. `quoteIsVerbatim()` (`src/lib/pipeline/verbatim.ts`) normalizes whitespace and quote characters and requires an exact or ≥85% 3-word-shingle match against the page text. Non-verbatim facts are dropped and the drop is written to the run log. In the real Buffer runs this removed 3 of 44 extracted facts on the first pricing page.
- **Stable ids the model can cite.** Prior facts, hypotheses, questions and events are rendered as `F12`, `H3`, `Q2`, `E5`. Returned ids are validated against what was actually given; unknown ids are dropped with a warning in the run log.
- **Confidence moves with evidence.** The synthesis prompt caps per-run movement, forbids 1.0, and asks for alternative explanations and counter-evidence in `reasoning`.
- **Revision, not deletion.** When evidence contradicts a hypothesis and supports a better reading, the model emits `revised`; Delta retires the old row, inserts the new one with `supersedesId`, and both keep their update history. The UI shows the old statement struck through above the new one.
- **User corrections are authoritative.** A correction stored on a hypothesis is injected into the next synthesis prompt as "USER CORRECTION (authoritative, must be respected)".
- **Diff-only change detection.** Two captures of `buffer.com/pricing` are compared line-by-line in code first (`src/lib/pipeline/diff.ts`); only added/removed lines go to the model, and identical captures cost no call. This removed the hallucinated "changes" we saw when the model was given both full pages.

## Reliability

- JSON mode (`response_format: json_object`) + Zod validation + one retry that includes the validation error.
- When `finish_reason === "length"` (reasoning models spend part of the budget thinking), the retry doubles `max_tokens`.
- The SDK retries 429/5xx with backoff; extraction runs 3 pages at a time because the API key allows 5 concurrent requests.
- A page that fails extraction is logged and skipped; a failed synthesis or insight stage marks the run `failed` but keeps everything persisted so far.
- `DELTA_MOCK_LLM=1` swaps in `MockLlmClient` so the whole pipeline runs offline in tests.

## Measured usage (real Buffer replay, Oct 31 2026)

| Run | Pages | Facts (+changes) | Hypothesis updates | Insights | Prompt tokens | Completion tokens | Wall time |
|---|---|---|---|---|---|---|---|
| Run 1 (≤ 2023-12-31) | 5 | 41 (+6) | 5 created | 3 | 46,356 | 65,435 | 323 s |
| Run 2 (≤ 2024-12-31) | 4 | 32 (+8) | 5 strengthened, 1 created | 4 | 45,723 | 71,739 | 296 s |
| Run 3 (≤ 2026-10-31) | 8 | 82 (+24) | 4 strengthened, 2 revised (+2 retired), 3 created | 4 | 105,408 | 124,526 | 537 s |

What Run 3 did to the record: H1 "Buffer is investing in agencies as a segment" rose to 0.85 even though the dedicated Agency plan disappeared; H4 "Buffer has no partner program" was retired and replaced by H7 (Agency Partner Program with 25% recurring commission); H6 "Buffer is moving upmarket to a custom tier" was retired and replaced by H8 (tiered self-serve per-channel pricing instead); three open questions from Runs 1–2 were resolved, including "does Buffer have a partner program?". The model also flagged a real inconsistency between the pricing page ($10/channel) and the help center ($12/channel) as a new open question.

Second competitor, SocialPilot (8 real pages, run Nov 1 2026):

| Run | Pages | Facts (+changes) | Hypothesis updates | Insights | Prompt tokens | Completion tokens | Wall time |
|---|---|---|---|---|---|---|---|
| Run 1 (≤ 2023-12-31) | 3 | 21 (+6) | 5 created | 4 | 21,010 | 38,827 | 191 s |
| Run 2 (≤ 2024-12-31) | 1 | 11 (+6) | 2 revised (+2 retired), 1 strengthened | 3 | 13,480 | 24,922 | 157 s |
| Run 3 (≤ 2026-11-01) | 4 | 31 (+18) | 4 strengthened, 1 revised (+1 retired), 1 created | 4 | 42,542 | 74,566 | 288 s |

Here the record revised itself twice: the 2022–2023 "full white-label platform" reading (H13) was replaced in Run 2 when the 2024 agency page dropped that claim, and the "account-based pricing" hypothesis (H16) was replaced in Run 3 by a flat-rate-vs-per-seat reading after the 2026 blog post.

Completion tokens are high relative to prompt tokens because both models reason before answering; `reasoning_effort: low` is used for extraction to keep this in check.

## Files

- `src/lib/stepfun/client.ts` — `StepFunClient`, `callJson()`, `MODELS`
- `src/lib/stepfun/mock.ts` — offline stand-in used by tests
- `src/lib/pipeline/prompts/*.ts` — the four prompts
- `src/lib/pipeline/extract.ts`, `synthesize.ts`, `run.ts` — the stages and the orchestrator
