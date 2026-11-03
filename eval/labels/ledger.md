# Labeling ledger

One line per labelled week, by a person (automated judges may triage, but humans decide). How to label and the thresholds are in [README.md](README.md). Sheets are written to `data/labels/<date>.csv` after each digest. `npm run eval:sample` makes one by hand.

Bars: hard-fact precision ≥ 98% on a rolling 8 weeks (target ≥ 99%), quotes 100%, stale + duplicate ≤ 5%.

| Week of | Items | Hard-fact precision | Quotes (`eval:gates`) | Stale + dup | ≥ 0.80 hypotheses later contradicted | Labeller | Notes |
|---|---|---|---|---|---|---|---|
