# Backfill: the ordering invariant

`runBackfill` walks cutoffs in ascending date order. For each cutoff it first stores the Wayback captures dated on or before that cutoff (`snapshots.published_at = capture date`), then starts a run with `cutoff_date = cutoff`.

`selectSnapshotsForRun` picks every snapshot with `processed_run_id IS NULL` and `published_at <= cutoff_date`. Because the cutoffs ascend and every earlier run already consumed its snapshots, each backfill run sees exactly the captures of its own window plus anything older that an earlier run could not process. `assertPointInTime` (phase 3) additionally refuses to synthesize when a prior fact's page postdates the run cutoff, so a mis-dated capture fails the run instead of leaking the future into the past.

Failure mode worth knowing: if a capture dated before an already-completed cutoff is inserted later (a second backfill with a finer step, or a manual Wayback add), it is picked up by the next run, whichever cutoff that has. That is correct point-in-time behaviour (the record learns it late, with the capture's own date), not leakage.

Resumability: a cutoff with a `done` run of `kind = 'backfill'` is skipped on re-run; a killed worker therefore resumes at the first unfinished cutoff and never runs a cutoff twice.
