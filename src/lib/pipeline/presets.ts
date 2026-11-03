import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { RunKind } from "@/db/schema";

export type RunPreset = { kind: RunKind; label: string; cutoffDate: string };

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The demo replay: each run only sees pages dated on or before its cutoff. */
export const REPLAY_RUNS: Omit<RunPreset, "kind">[] = [
  { label: "Run 1", cutoffDate: "2023-12-31" },
  { label: "Run 2", cutoffDate: "2024-12-31" },
  // The last replay sees everything up to today, so live URLs added before it are included.
  { label: "Run 3", cutoffDate: todayIso() },
];

function countDone(db: Db, competitorId: number, kind?: RunKind): number {
  const rows = db
    .select({ id: schema.runs.id, kind: schema.runs.kind })
    .from(schema.runs)
    .where(and(eq(schema.runs.competitorId, competitorId), eq(schema.runs.status, "done")))
    .all();
  return kind ? rows.filter((r) => r.kind === kind).length : rows.filter((r) => r.kind !== "check").length;
}

/**
 * The next run a person would start from the UI or CLI: a competitor still in
 * its demo replay (seeded pages, fewer completed replay runs than presets)
 * gets the next dated preset; everything else gets "Run N" dated today.
 * The worker builds its own `scheduled` presets instead.
 */
export function nextRun(db: Db, competitorId: number): RunPreset {
  const seeded = db
    .select({ id: schema.sources.id })
    .from(schema.sources)
    .where(and(eq(schema.sources.competitorId, competitorId), eq(schema.sources.provider, "seeded")))
    .get();
  if (seeded) {
    const doneReplays = countDone(db, competitorId, "replay");
    if (doneReplays < REPLAY_RUNS.length) return { kind: "replay", ...REPLAY_RUNS[doneReplays] };
  }
  return { kind: "manual", label: `Run ${countDone(db, competitorId) + 1}`, cutoffDate: todayIso() };
}

/** Label for a worker run started today. */
export function scheduledPreset(now = new Date()): RunPreset {
  const date = now.toISOString().slice(0, 10);
  return { kind: "scheduled", label: `Week of ${date}`, cutoffDate: date };
}
