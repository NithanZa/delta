/**
 * Fill competitors.domain from competitors.website for rows created before
 * the watchlist migration (0004). Safe to re-run.
 *
 *   npx tsx scripts/backfill-domains.ts
 */
import { eq } from "drizzle-orm";
import { createDb, schema } from "@/db";
import { env } from "@/lib/env";
import { domainFromWebsite } from "@/lib/ingest/watchlist";

const db = createDb(env.dbPath);
let n = 0;
for (const c of db.select().from(schema.competitors).all()) {
  const domain = domainFromWebsite(c.website);
  if (domain && domain !== c.domain) {
    db.update(schema.competitors).set({ domain }).where(eq(schema.competitors.id, c.id)).run();
    console.log(`${c.slug}: domain = ${domain}`);
    n++;
  }
}
console.log(`${n} competitor(s) updated in ${env.dbPath}`);
