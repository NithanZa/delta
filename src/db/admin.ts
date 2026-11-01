import { sql } from "drizzle-orm";
import type { Db } from "./index";

const DERIVED_TABLES = [
  "insights",
  "hypothesis_updates",
  "hypotheses",
  "strategy_profiles",
  "timeline_events",
  "open_questions",
  "facts",
  "runs",
] as const;

/** Delete everything a run produces; keep company, competitors, questions and snapshots. */
export function wipeDerived(db: Db) {
  for (const t of DERIVED_TABLES) db.run(sql.raw(`delete from ${t}`));
  db.run(sql`update snapshots set processed_run_id = null`);
}

/** Delete every row in every table. */
export function wipeAll(db: Db) {
  wipeDerived(db);
  for (const t of ["snapshots", "sources", "research_questions", "competitors", "company"]) db.run(sql.raw(`delete from ${t}`));
  db.run(sql`delete from sqlite_sequence`);
}
