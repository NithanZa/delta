import type { Fact, Run } from "@/db/schema";
import type { ResearchState } from "./state";

export class PointInTimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PointInTimeError";
  }
}

/**
 * A run may only reason over pages dated on or before its cutoff. The snapshot
 * selection already filters new pages; this guard protects synthesis against a
 * record that already contains later facts (backfill runs with an earlier
 * cutoff, manual runs, imported data). Throws before any model call.
 */
export function assertPointInTime(run: Pick<Run, "cutoffDate" | "label">, state: Pick<ResearchState, "priorFacts" | "snapshotsById">, newFacts: Fact[]): void {
  const offenders: string[] = [];
  const check = (f: Fact, origin: string) => {
    const snap = state.snapshotsById.get(f.snapshotId);
    const date = snap?.publishedAt;
    if (date === undefined) offenders.push(`F${f.id} (${origin}; snapshot ${f.snapshotId} unknown)`);
    else if (date > run.cutoffDate) offenders.push(`F${f.id} (${origin}; page dated ${date})`);
  };
  for (const f of state.priorFacts) check(f, "prior");
  for (const f of newFacts) check(f, "new");
  if (offenders.length) {
    throw new PointInTimeError(
      `Point-in-time violation in ${run.label}: ${offenders.length} fact(s) rest on pages dated after the cutoff ${run.cutoffDate}: ${offenders.slice(0, 10).join(", ")}${offenders.length > 10 ? ", …" : ""}`,
    );
  }
}
