# Weekly labeling

`npm run eval:sample -- --db <path> --since <date> --n 25 --out eval/labels/<date>.csv` writes a stratified sheet: 10 change facts, 5 pages checked with no change, 5 hypothesis updates, 5 random insights/facts. Labeling 25 items takes about 20 minutes.

## Columns

| Column | Meaning |
|---|---|
| `id` | `F<id>` fact, `S<id>` snapshot (page checked, no change found), `HU<id>` hypothesis update, `I<id>` insight |
| `kind` | `fact`, `change_fact`, `page_no_change`, `hypothesis_<change>`, `insight` |
| `text` | The statement, the update's hypothesis and reasoning, or the insight title and observation |
| `quote` | The verbatim quote stored with a fact (empty for other kinds) |
| `source_url`, `published_at` | Where and when the evidence was captured |
| `confidence` | Hypothesis confidence after the update, or the insight severity |
| `label` | One of the five labels below (you fill this in) |
| `note` | Optional: what was wrong, or what you checked |

## Labels

Open `source_url` (use the Wayback capture for historical pages) and decide **before** looking at the confidence column:

- **Supported** — the statement is true of the source as of `published_at`, and the quote supports it.
- **Partially supported** — the gist is right but a detail is wrong or missing (a number, a cadence, which plan).
- **Unsupported** — the source does not say this.
- **Contradicted** — the source says the opposite.
- **Post-cutoff/Stale** — the statement rests on a page dated after the run cutoff, or restates something already recorded (duplicate).

For `page_no_change` rows the question is: did the page in fact change materially since the previous capture? Label **Supported** when nothing material changed, **Contradicted** when something material did.

For hypothesis updates, judge whether the cited facts justify the direction and size of the move, not whether the hypothesis is ultimately true (that is settled later by resolution and calibration).

## Thresholds (from the ground-truth audit, 2026-11-02)

| Metric | Floor | Target | Action when missed |
|---|---|---|---|
| Hard-fact precision (Supported + Partially supported on facts and change facts) | ≥ 98% on an 8-week rolling window | ≥ 99% | Block digests above 2% wrong; investigate any material pricing, ownership or availability error the same week |
| Quotes verbatim | 100% (from `eval:gates`, not from labels) | 100% | Digest is held |
| Stale + duplicate rate | ≤ 5% | — | Tighten dedupe and point-in-time checks |
| False "no change" on pages | ≤ 5% | — | Review the diff filter |
| Hypotheses later contradicted | ≤ 10–15% of ≥ 0.80 hypotheses | Brier ≤ 0.20 once ~50 are resolved | Prompt and confidence-cap review |

Append one line per labelled week to `eval/labels/ledger.md` (created in phase 12): date, items, hard-fact precision, quotes, stale+dup rate, notes.
