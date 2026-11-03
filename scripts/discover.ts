/**
 * Off-domain discovery and absence checks from the command line.
 *
 *   npm run discover -- --competitor socialpilot --since 2025-06-01 --until 2025-08-31
 *   npm run discover -- --competitor buffer --absence [--force]
 *   npm run discover -- --all
 */
import { eq } from "drizzle-orm";
import { createDb, schema } from "@/db";
import { env } from "@/lib/env";
import { discoverCompetitor } from "@/lib/ingest/discovery";
import { runAbsenceChecks } from "@/lib/pipeline/absence";
import { getSetting } from "@/lib/settings";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const flag = (name: string) => process.argv.includes(`--${name}`);
const iso = (d: string) => (d.length === 10 ? `${d}T00:00:00.000Z` : d);

async function main() {
  const db = createDb(env.dbPath);
  const slug = arg("competitor");
  const competitors = flag("all") ? db.select().from(schema.competitors).all() : slug ? db.select().from(schema.competitors).where(eq(schema.competitors.slug, slug)).all() : [];
  if (competitors.length === 0) {
    console.error("Usage: npm run discover -- --competitor <slug> | --all [--since YYYY-MM-DD --until YYYY-MM-DD] [--absence] [--force]");
    process.exit(1);
  }
  const now = new Date();
  const until = arg("until") ? iso(arg("until")!) : now.toISOString();
  const since = arg("since") ? iso(arg("since")!) : new Date(new Date(until).getTime() - getSetting(db, "discovery.lookbackDays") * 86_400_000).toISOString();
  const log = (m: string) => console.log(`  ${m}`);
  let failed = false;
  for (const c of competitors) {
    if (flag("absence")) {
      console.log(`▶ absence checks for ${c.name}${flag("force") ? " [force]" : ""}`);
      const r = await runAbsenceChecks(db, c.id, { force: flag("force"), log });
      console.log(`  ${JSON.stringify(r)}`);
      if (r.errors) failed = true;
      continue;
    }
    if (!env.exaApiKey) {
      console.error("EXA_API_KEY is not set; discovery needs it (absence checks work without it: --absence).");
      process.exit(1);
    }
    console.log(`▶ discovery for ${c.name} ${since.slice(0, 10)} → ${until.slice(0, 10)}`);
    const r = await discoverCompetitor(db, c.id, { since, until, log });
    console.log(`  ${JSON.stringify({ ...r, usage: undefined })} · tokens ${r.usage.promptTokens}+${r.usage.completionTokens} · exa $${r.exaCostUsd.toFixed(3)}`);
    if (r.errors) failed = true;
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
