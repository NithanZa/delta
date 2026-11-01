import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

export type RunPreset = { label: string; cutoffDate: string };

/** The replay: each run only sees pages dated on or before its cutoff. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export const REPLAY_RUNS: RunPreset[] = [
  { label: "Run 1", cutoffDate: "2023-12-31" },
  { label: "Run 2", cutoffDate: "2024-12-31" },
  // The last replay sees everything up to today, so live URLs added before it are included.
  { label: "Run 3", cutoffDate: todayIso() },
];

/** The next preset not yet completed; after the presets, "Run N" with today's date. */
export function nextReplayRun(db: Db, competitorId: number): RunPreset {
  const done = db
    .select({ id: schema.runs.id })
    .from(schema.runs)
    .where(and(eq(schema.runs.competitorId, competitorId), eq(schema.runs.status, "done")))
    .all().length;
  return REPLAY_RUNS[done] ?? { label: `Run ${done + 1}`, cutoffDate: todayIso() };
}
