/**
 * Run the deterministic trust gates against a Delta database.
 *
 *   npm run eval:gates                       # data/delta.db
 *   npm run eval:gates -- --db data/demo/delta.demo.db
 *
 * Exit code 1 when any gate has a violation.
 */
import { env } from "@/lib/env";
import { arg } from "./lib/args";
import { exitCodeFor, formatReport, openReadOnly, runGates } from "./lib/gates";

const dbPath = arg("db") ?? env.dbPath;
const db = openReadOnly(dbPath);
const report = runGates(db);
console.log(`Trust gates on ${dbPath}\n`);
console.log(formatReport(report));
process.exit(exitCodeFor(report));
