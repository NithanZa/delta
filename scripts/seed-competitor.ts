/**
 * Add one competitor from data/seed to an EXISTING database without wiping
 * anything: the competitor row, its research questions (questions.json) and
 * the snapshots already fetched into data/corpus/{slug}/snapshots by
 * `npm run corpus:fetch -- --slug {slug}`. Skips when the slug already exists.
 *
 *   npm run seed:competitor -- --slug socialpilot
 */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createDb, schema } from "@/db";
import { env } from "@/lib/env";
import { applyWatchFlags, corpusDir } from "@/lib/ingest/providers";
import { insertSnapshotRecord, type SnapshotRecord } from "@/lib/ingest/snapshot";
import { domainFromWebsite } from "@/lib/ingest/watchlist";

type SeedCompetitor = { name: string; slug: string; website: string; description: string };
type SeedQuestions = Record<string, string[]>;

const seedDir = path.resolve(process.cwd(), "data", "seed");
const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(seedDir, file), "utf8")) as T;

function main() {
  const args = process.argv.slice(2);
  const slug = args.includes("--slug") ? args[args.indexOf("--slug") + 1] : undefined;
  if (!slug) {
    console.error("Usage: npm run seed:competitor -- --slug <slug>");
    process.exit(1);
  }

  const competitor = readJson<SeedCompetitor[]>("competitors.json").find((c) => c.slug === slug);
  if (!competitor) {
    console.error(`No competitor with slug "${slug}" in ${path.join(seedDir, "competitors.json")}`);
    process.exit(1);
  }
  const questions = readJson<SeedQuestions>("questions.json")[slug] ?? [];
  const snapshotDir = path.join(corpusDir(slug), "snapshots");
  const files = fs.existsSync(snapshotDir) ? fs.readdirSync(snapshotDir).filter((f) => f.endsWith(".json")).sort() : [];

  const db = createDb(env.dbPath);
  const existing = db.select().from(schema.competitors).where(eq(schema.competitors.slug, slug)).get();
  if (existing) {
    console.log(`Competitor "${existing.name}" (${slug}) already exists in ${env.dbPath} as id ${existing.id}; nothing changed.`);
    return;
  }

  // One transaction on the shared connection: a failed snapshot leaves no half-added competitor behind.
  const { row, created } = db.transaction(() => {
    const row = db.insert(schema.competitors).values({ ...competitor, domain: domainFromWebsite(competitor.website) }).returning().get();
    for (const text of questions) db.insert(schema.researchQuestions).values({ competitorId: row.id, text }).run();
    let created = 0;
    for (const file of files) {
      const rec = JSON.parse(fs.readFileSync(path.join(snapshotDir, file), "utf8")) as SnapshotRecord;
      if (insertSnapshotRecord(db, row.id, rec).created) created++;
    }
    applyWatchFlags(db, row.id, slug);
    return { row, created };
  });

  console.log(`Added ${row.name} (${slug}) to ${env.dbPath}: id=${row.id}, questions=${questions.length}, snapshots=${created} (from ${files.length} files)`);
  if (files.length === 0) console.warn(`No snapshots in ${snapshotDir}. Fetch them first: npm run corpus:fetch -- --slug ${slug}`);
}

main();
