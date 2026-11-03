# Delta prototype

## Outcome

The commercial-detail failure modes from the audit are fixed in schema, prompts and code: price facts carry a billing cadence; feature facts carry an availability status; absence claims ("no partner program") are capped unless an explicit absence check exists; conflicting official sources become conflict questions instead of a silent pick; a line vanishing from a page is phrased as "no longer listed", not "discontinued"; and a point-in-time guard throws before any model call if a fact postdates the run cutoff. All phase-2 regression cases pass.

## Step-by-step

1. **Schema** (`npx drizzle-kit generate --name trust-fields` → `drizzle/0003_*.sql`):
   - `facts`: `claim_kind` enum `observed | absence` default `observed`; `billing_cadence` enum `monthly | annual | one_time | unknown` nullable; `availability` enum `shipped | announced | coming_soon | beta | deprecated | unknown` nullable; `attribution` text default `'public'` (used by phase 7 for internal notes).
   - `hypotheses`: `claim_kind` enum `positive | absence` default `positive`.
   - `open_questions`: `kind` enum `investigation | conflict` default `investigation`; `fact_ids` JSON default `[]`.
   Export the new const arrays from `src/db/schema.ts`; update `schema.test.ts`.

2. **Extraction prompt** (`src/lib/pipeline/prompts/extractFacts.ts`) — add rules and output fields:
   - Pricing: "For every price, say what it covers and the billing cadence. Look for 'billed yearly', 'billed annually', '/year', 'per month billed annually', toggles like 'Monthly | Yearly' near the price. If a page shows both a monthly and an annual-equivalent price, extract them as two facts with `billingCadence` set to `monthly` and `annual`. If the cadence is not visible, use `unknown`. Never describe an annual-equivalent monthly price as cheaper than the monthly price."
   - Availability: "A capability described as 'coming soon', 'on the roadmap', 'next release', 'beta', 'early access' or in future tense is not shipped: set `availability` accordingly and phrase the statement as announced/planned. Use `shipped` only for capabilities the page presents as available now."
   - Page scope: "A page not mentioning something is not evidence that it does not exist. Never emit a fact that something is absent."
   Extend `FactSchema` (lenient, with `.catch`) and `FactWire` (strict) with `billingCadence` and `availability`.

3. **Change prompt** (`prompts/detectChange.ts`):
   - "A switch between monthly and annual price display is not a price change. If the removed and added lines show the same offer at a different cadence, return no change or a change whose statement says only that the display cadence changed."
   - "A line that disappeared means the page no longer lists it. Say 'no longer listed on this page'. Do not say removed, discontinued or dropped unless the page says so; the item may have moved to another page."
   - Keep the existing "both dates" rule and add it to the wire schema docs.

4. **Synthesis prompt** (`prompts/synthesize.ts`) and `SynthesisOutput`/`SynthesisWire`:
   - Absence: every hypothesis update carries `claimKind: "positive" | "absence"`. "An absence claim (the competitor lacks X, has no X) may only exceed confidence 0.4 when it cites a fact with `claimKind` `absence` produced by an explicit check. Otherwise state it as an open question."
   - Conflicts: new output array `conflicts: [{ question, factIds }]`. "When two official sources disagree on a number or an entitlement, do not choose one. Emit a conflict with both fact ids, and make the strategy profile mention both values. First check whether the two values differ only by billing cadence or by date; those are not conflicts."
   - Availability: "A hypothesis that a capability exists must cite facts with `availability` `shipped`. Facts marked `coming_soon`/`announced` support only statements about plans."
   - Windows: "Claims that something changed between two dates must cite captures on both sides of the window."
   Render `billingCadence`, `availability` and `claimKind` in `formatFact()` (`src/lib/pipeline/state.ts`) so the model sees them.

5. **Code enforcement** in `src/lib/pipeline/synthesize.ts`:
   - Absence cap: if `u.claimKind === "absence"` and none of the validated `factIds` is a fact with `claim_kind = 'absence'`, set `confidence = Math.min(confidence, 0.4)` and log a `warn` with the hypothesis id. Store `claim_kind` on the hypothesis row (also on `revised` replacements).
   - Conflicts: insert `open_questions` rows with `kind = 'conflict'` and validated `fact_ids`; de-duplicate against open conflict questions citing the same fact set.
   - `assertPointInTime(run, state, newFacts)` in a new `src/lib/pipeline/guards.ts`: throws if any new fact or any prior fact's snapshot `publishedAt > run.cutoffDate`. Call it at the top of `runSynthesis` and `runInsights`. `selectSnapshotsForRun` already filters, so this protects backfill (phase 10) and manual runs.

6. **Verbatim gate exemption.** `filterVerbatim()` in `extract.ts` and G1 in `eval/lib/gates.ts` skip facts with `claimKind = 'absence'` (those are created in phase 8 with an empty quote). `FactSchema` keeps `quote.min(8)` for observed facts.

7. **Insights prompt** (`prompts/insights.ts`): "When `whatHappened` mentions a price, state its billing cadence. When a capability is `coming_soon`, write 'plans to' or 'announced'. Never assert absence unless an absence fact is cited."

8. **UI.** `src/components/evidence-list.tsx`: badges for cadence (`annual`/`monthly`), availability (`coming soon`, `beta`, `announced`), and `absence check`. `src/components/questions-tab.tsx`: `conflict` badge and the two cited facts expanded. `src/components/overview.tsx` `HypothesisCard`: badge `absence claim · unverified` when `claim_kind = 'absence'` and the latest update cites no absence fact (compute in `src/lib/queries.ts`).

9. **Mock handlers** in `src/lib/llm/mock.ts` emit the new fields; existing unit tests updated; new tests: absence cap (mock emits 0.8 → stored 0.4 and warn logged), conflict insertion + dedupe, `assertPointInTime` throws, verbatim exemption.

10. **Regression and replay.** `npm run eval:regress` → E01–E18 green. Then `npm run demo:fresh` and three Buffer runs with the default models; compare with the audit: the "$10 vs $12" item must no longer be a conflict (cadence resolved), guest access must read as planned, and no absence hypothesis may exceed 0.4 without a check. Optionally re-snapshot `data/demo/delta.demo.db` (`npm run demo:snapshot`) so the shipped demo reflects the fixes; note the cost (~$5, ~20 minutes with Opus synthesis).

## Acceptance criteria

- [x] AC1 (run with the StepFun models; no Anthropic key available, per Nithan on 2026-11-02): `npm run eval:regress` passes all 18 cases with the default phase-1 models.
- [x] AC2: Unit tests prove the absence cap, conflict question insertion with `fact_ids`, and that `runSynthesis` throws on a prior fact dated after the cutoff.
- [x] AC3: After a fresh three-run Buffer replay, `npm run eval:gates` passes, no hypothesis with `claim_kind = 'absence'` has confidence > 0.4, and the Questions tab shows cadence-aware behaviour (no conflict raised between an annual and a monthly price).
- [x] AC4: Evidence cards show cadence/availability badges; conflict questions show both cited facts.
- [x] AC5: `npm run check`, `npm test` pass; `drizzle/0003_*.sql` is committed and `schema.test.ts` lists the new columns' tables unchanged.
