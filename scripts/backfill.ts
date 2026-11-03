/**
 * Wayback backfill from the command line.
 *
 *   npm run backfill -- --competitor socialpilot --plan-only
 *   npm run backfill -- --competitor socialpilot [--months 24] [--step quarter|month] [--with-discovery]
 */
import { eq } from "drizzle-orm";
import { createDb, schema } from "@/db";
import { env } from "@/lib/env";
import { formatPlan, planBackfill, type BackfillStep } from "@/lib/backfill/plan";
import { runBackfill } from "@/lib/backfill/run";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const db = createDb(env.dbPath);
  const slug = arg("competitor");
  const competitor = slug ? db.select().from(schema.competitors).where(eq(schema.competitors.slug, slug)).get() : undefined;
  if (!competitor) {
    console.error("Usage: npm run backfill -- --competitor <slug> [--months 24] [--step quarter|month] [--with-discovery] [--plan-only]");
    process.exit(1);
  }
  const months = Number(arg("months") ?? 24);
  const step = (arg("step") ?? "quarter") as BackfillStep;
  const log = (m: string) => console.log(`  ${m}`);
  console.log(`▶ backfill plan for ${competitor.name}: ${months} months, ${step}ly`);
  const plan = await planBackfill(db, competitor.id, { months, step, log });
  const sources = db.select({ url: schema.sources.url }).from(schema.sources).where(eq(schema.sources.competitorId, competitor.id)).all();
  console.log(formatPlan(plan, sources));
  if (flag("plan-only")) return;
  console.log(`\n▶ running backfill`);
  // The worker owns a backfill while its job is active; otherwise a leftover running row is from a killed process.
  const workerOwnsIt = db.select().from(schema.jobs).all().some((j) => j.kind === "backfill" && j.competitorId === competitor.id && (j.status === "queued" || j.status === "running"));
  if (workerOwnsIt) {
    console.error("The worker has a backfill queued or running for this competitor; see /ops.");
    process.exit(1);
  }
  const r = await runBackfill(db, competitor.id, { plan, releaseOrphans: true, withDiscovery: flag("with-discovery"), log, onProgress: (p) => console.log(`  … ${p.stage} (${p.cutoffsDone}/${p.cutoffsTotal}, ${p.pagesFetched} pages)`) });
  console.log(JSON.stringify(r));
  process.exit(r.stopped ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
