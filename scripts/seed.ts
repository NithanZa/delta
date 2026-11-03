/**
 * Reset the database and load the demo company, competitors, research
 * questions and the seeded corpus snapshots.
 *
 *   npm run seed
 */
import fs from "node:fs";
import path from "node:path";
import { createDb, schema } from "@/db";
import { wipeAll } from "@/db/admin";
import { env } from "@/lib/env";
import { applyWatchFlags, corpusDir } from "@/lib/ingest/providers";
import { insertSnapshotRecord, type SnapshotRecord } from "@/lib/ingest/snapshot";
import { domainFromWebsite } from "@/lib/ingest/watchlist";

type SeedCompany = typeof schema.company.$inferInsert;
type SeedCompetitor = { name: string; slug: string; website: string; description: string };
type SeedQuestions = Record<string, string[]>;

const seedDir = path.resolve(process.cwd(), "data", "seed");
const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(seedDir, file), "utf8")) as T;

function main() {
  const db = createDb(env.dbPath);
  wipeAll(db);

  const company = readJson<SeedCompany>("company.json");
  db.insert(schema.company).values(company).run();

  const competitors = readJson<SeedCompetitor[]>("competitors.json");
  const questions = readJson<SeedQuestions>("questions.json");
  let snapshotCount = 0;
  let questionCount = 0;

  for (const c of competitors) {
    const row = db.insert(schema.competitors).values({ ...c, domain: domainFromWebsite(c.website) }).returning().get();
    for (const q of questions[c.slug] ?? []) {
      db.insert(schema.researchQuestions).values({ competitorId: row.id, text: q }).run();
      questionCount++;
    }
    const dir = path.join(corpusDir(c.slug), "snapshots");
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as SnapshotRecord;
      const { created } = insertSnapshotRecord(db, row.id, rec);
      if (created) snapshotCount++;
    }
    applyWatchFlags(db, row.id, c.slug);
  }

  console.log(`Seeded ${env.dbPath}: company=${company.name}, competitors=${competitors.length}, questions=${questionCount}, snapshots=${snapshotCount}`);
}

main();
