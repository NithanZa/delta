/**
 * Remove all runs and derived analysis; keep the company, competitors,
 * research questions and snapshots so the replay can be run again.
 *
 *   npm run demo:reset
 */
import { createDb } from "@/db";
import { wipeDerived } from "@/db/admin";
import { env } from "@/lib/env";

const db = createDb(env.dbPath);
wipeDerived(db);
console.log(`Reset ${env.dbPath}: runs and derived analysis removed; snapshots kept.`);
