# Delta prototype

## Outcome

A separate **worker process** runs on a schedule read from settings: crawl daily, research run weekly, digest weekly (digest job lands in phase 7, discovery in phase 8, backfill in phase 10). Runs have a `kind`; a scheduled run that finds nothing new is recorded as `skipped` instead of spending tokens; jobs and the worker heartbeat are visible on an `/ops` page with "run now" buttons that enqueue work for the worker. The web process keeps the existing in-request manual run with its NDJSON stream.

## Step-by-step

1. **Schema** (`drizzle-kit generate --name jobs`):
   - `runs`: add `kind` enum `replay | manual | scheduled | backfill` default `manual`.
   - new `settings`: `key` text primary key, `value` JSON, `updated_at`.
   - new `jobs`: `id, kind ('crawl'|'run'|'digest'|'discovery'|'backfill'|'backup'), competitor_id nullable, status ('queued'|'running'|'done'|'failed'|'skipped'), requested_by ('schedule'|'ui'|'cli'), payload JSON, log JSON (RunLogEntry[]), error, created_at, started_at, finished_at`.

2. **Settings helper** `src/lib/settings.ts`: typed `getSetting(db, key)` / `setSetting(db, key, value)` with defaults: `schedule.timezone` (env `TZ` or `"UTC"`), `schedule.crawlCron` `"0 3 * * *"`, `schedule.runCron` `"0 5 * * MON"`, `schedule.digestCron` `"0 8 * * MON"`, `schedule.discoveryCron` `"0 4 * * MON"`, `worker.heartbeatAt`. Validate cron strings with `new Cron(pattern)` inside try/catch when saving from the UI.

3. **Jobs** `src/lib/jobs/queue.ts`: `enqueue(db, { kind, competitorId?, payload, requestedBy })`, `claimNext(db)` (one short transaction: oldest `queued` → `running` with `started_at`), `finish(db, id, status, error?)`, `appendLog`. `src/lib/jobs/run.ts` dispatches by kind:
   - `crawl` → `crawlCompetitor` for the competitor or all.
   - `run` → skip rule first: no snapshots with `processed_run_id IS NULL` and no hypothesis with a pending correction (`user_correction` set and `correction_applied_run_id IS NULL`) and no pending internal notes (phase 7) → `status = 'skipped'` with reason "nothing new since <last run>"; otherwise `startRun({ kind: 'scheduled', label: 'Week of <YYYY-MM-DD>', cutoffDate: today })` + `executeRun`, mirroring run events into the job log.
   - `backup` → copy the SQLite file with better-sqlite3's online backup (`db.$client.backup(path)`) to `data/backups/delta-<date>.db`, keep 14.

4. **Worker** `scripts/worker.ts` (`npm run worker`): opens the DB, loads settings, schedules with croner (`protect: true` so a long run never overlaps itself, `catch: (err) => log`, `timezone` from settings): crawl all competitors on `crawlCron`; `run` for each competitor on `runCron`; `backup` daily; (phase 7 adds digest, phase 8 discovery). A 20 s loop claims queued jobs from the UI/CLI. Writes `worker.heartbeatAt` every minute. Re-reads settings every 5 minutes and reschedules if cron strings changed (`job.stop()` then recreate). Graceful shutdown on `SIGINT`/`SIGTERM`: stop schedulers, wait for the current job, exit.

5. **Presets → next run.** Replace `nextReplayRun` in `src/lib/pipeline/presets.ts` with `nextRun(db, competitorId)`: a competitor still in replay (has `provider = 'seeded'` snapshots and fewer done `kind = 'replay'` runs than `REPLAY_RUNS.length`) gets the next preset with `kind: 'replay'`; otherwise `{ kind: 'manual', label: 'Run N', cutoffDate: today }`. `src/app/api/runs/route.ts` passes `kind: 'manual'`; the worker passes `scheduled`. Update `src/lib/queries.ts` and `scripts/run.ts`.

6. **Stale threshold.** `STALE_AFTER_MS` in `src/lib/pipeline/run.ts` is 10 minutes of no log progress; an Opus synthesis over a two-year record can approach that. Raise to 20 minutes and make the worker emit a heartbeat log line every 60 s during synthesis (wrap the model call with an interval that appends "still reasoning…").

7. **`/ops` page** `src/app/ops/page.tsx`: worker status (heartbeat age; red if > 3 min), next scheduled times per job computed with `new Cron(pattern, { timezone }).nextRun()`, last 50 jobs with status, duration, error and an expandable log, and buttons "Crawl now", "Run now", "Backup now" per competitor (server actions that `enqueue`). `src/app/api/jobs/[id]/route.ts` GET returns a job for polling. Settings page gets a "Schedule" card (cron strings + timezone with validation and a human-readable next-run preview).

8. **Run panel.** When a scheduled run is in progress the existing polling fallback in `src/components/run-panel.tsx` shows its log (`isRunning` comes from `runs`); add the run `kind` to the chips (`scheduled`, `backfill`).

9. **Tests.** `queue.test.ts` (enqueue/claim ordering, finish), skip rule (nothing new → skipped; pending correction → runs), `nextRun` for seeded vs live competitors, cron validation, backup creates a file and prunes to 14. The worker loop itself is covered by a smoke test that constructs the schedulers with `paused: true` and asserts `nextRun()` dates.

## API notes (verified 2026-11-02)

**croner 11.0.0** (`npm install croner`):

```ts
import { Cron } from "croner";
const job = new Cron("0 5 * * MON", { timezone: "America/New_York", name: "weekly-run", protect: true, catch: (e) => console.error(e) }, async () => { /* work */ });
job.nextRun();        // Date | null
job.nextRuns(3);      // Date[]
job.isBusy();         // true while the callback runs
job.pause(); job.resume(); job.stop();   // stop() is permanent
new Cron("0 5 * * MON", { paused: true }); // validate without scheduling
```
Patterns: 5 fields `MIN HOUR DOM MON DOW` (6 fields add leading seconds; `mode` option pins the arity); nicknames like `@weekly` accepted; `DOW` 0–7 or `MON`. Constructor throws on an invalid pattern. Options used: `timezone` (IANA), `protect` (skip a tick while the previous callback is still running), `catch`, `name`, `paused`, `maxRuns`, `startAt`/`stopAt`.

**better-sqlite3 online backup**: `db.backup(destinationPath)` returns a Promise and works while other connections write (WAL). Through drizzle the raw connection is `db.$client`.

## Acceptance criteria

- [x] AC1: `npm run worker` starts, logs the next crawl/run/backup times in the configured timezone, and writes `worker.heartbeatAt` within 60 s; `/ops` shows it green.
- [x] AC2: Clicking "Run now" on `/ops` enqueues a job that the worker claims within 20 s; with no new snapshots the job finishes `skipped` with a reason; after `npm run crawl` produces a new snapshot the same action produces a `done` run with `kind = 'scheduled'`.
- [x] AC3: Two overlapping triggers never run the same competitor concurrently (`startRun` throws "already running"; the second job finishes `failed` with that message).
- [x] AC4: Changing `schedule.runCron` in Settings is picked up by the worker within 5 minutes (log line "rescheduled").
- [x] AC5 (verified in a Linux container: SIGTERM mid-run finished the run in 87 s and exited 0): `SIGTERM` during a run lets the run finish and exits 0; `data/backups/` holds at most 14 files after the backup job.
- [x] AC6: `npm run check`, `npm test` pass; `drizzle/0005_*.sql` committed.
