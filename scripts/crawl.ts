/**
 * Re-fetch watched pages and poll feeds for one or all competitors.
 *
 *   npm run crawl -- --competitor buffer
 *   npm run crawl -- --all [--force] [--dry-run] [--max-new 20]
 */
import { eq } from "drizzle-orm";
import { createDb, schema } from "@/db";
import { env } from "@/lib/env";
import { crawlCompetitor } from "@/lib/ingest/crawl";
import { exaTextFallback } from "@/lib/ingest/discovery";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const db = createDb(env.dbPath);
  const slug = arg("competitor");
  const competitors = flag("all")
    ? db.select().from(schema.competitors).all()
    : slug
      ? db.select().from(schema.competitors).where(eq(schema.competitors.slug, slug)).all()
      : [];
  if (competitors.length === 0) {
    console.error("Usage: npm run crawl -- --competitor <slug> | --all [--force] [--dry-run] [--max-new N]");
    process.exit(1);
  }
  let failed = false;
  for (const c of competitors) {
    console.log(`▶ crawl ${c.name} (${c.slug})${flag("dry-run") ? " [dry run]" : ""}${flag("force") ? " [force]" : ""}`);
    const t0 = Date.now();
    const result = await crawlCompetitor(db, c.id, {
      force: flag("force"),
      dryRun: flag("dry-run"),
      maxNewPages: arg("max-new") ? Number(arg("max-new")) : undefined,
      fallbackText: env.exaApiKey ? (url) => exaTextFallback(url) : undefined,
      log: (m) => console.log(`  ${m}`),
    });
    if (result.errors) failed = true;
    console.log(`  ${JSON.stringify(result)} in ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
