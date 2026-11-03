/**
 * Write a labeling sheet from the command line.
 *
 *   npm run eval:sample -- --db data/demo/delta.demo.db --since 2026-10-01 --n 25 --out eval/labels/2026-11-02.csv
 */
import path from "node:path";
import { env } from "@/lib/env";
import { arg } from "./lib/args";
import { openReadOnly } from "./lib/gates";
import { writeLabelSample } from "./lib/sampler";

const dbPath = arg("db") ?? env.dbPath;
const n = Number(arg("n") ?? 25);
const since = arg("since") ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
const out = arg("out") ?? path.resolve(process.cwd(), "eval", "labels", `${new Date().toISOString().slice(0, 10)}.csv`);

const r = writeLabelSample(openReadOnly(dbPath), { since, n, out, seed: `${dbPath}:${since}:${n}` });
if (!r) {
  console.error(`No completed runs since ${since} in ${dbPath}.`);
  process.exit(1);
}
console.log(`Wrote ${r.rows} row(s) to ${path.relative(process.cwd(), r.file)} (runs since ${since}: ${r.runs}; pools: ${r.pools.changeFacts} change facts, ${r.pools.quietPages} quiet pages, ${r.pools.updates} updates, ${r.pools.insights} insights, ${r.pools.facts} facts)`);
if (r.rows < n) console.log(`Only ${r.rows} of the requested ${n} rows were available.`);
