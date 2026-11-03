/**
 * Run Delta from the command line.
 *
 *   npm run run -- --competitor buffer --next
 *   npm run run -- --competitor buffer --label "Run 2" --cutoff 2024-12-31
 */
import { eq } from "drizzle-orm";
import { createDb, schema } from "@/db";
import { env } from "@/lib/env";
import { nextRun } from "@/lib/pipeline/presets";
import { executeRun, startRun } from "@/lib/pipeline/run";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const db = createDb(env.dbPath);
  const slug = arg("competitor") ?? "buffer";
  const competitor = db.select().from(schema.competitors).where(eq(schema.competitors.slug, slug)).get();
  if (!competitor) throw new Error(`No competitor with slug "${slug}". Run npm run seed first.`);

  const preset = process.argv.includes("--next") || !arg("label") ? nextRun(db, competitor.id) : { kind: "manual" as const, label: arg("label")!, cutoffDate: arg("cutoff")! };
  const run = startRun(db, { competitorId: competitor.id, ...preset }); // throws if a run is already in flight
  console.log(`▶ ${run.label} for ${competitor.name} (cutoff ${run.cutoffDate}, run id ${run.id})\n`);

  const result = await executeRun(db, run.id, (e) => {
    const lvl = e.level && e.level !== "info" ? ` ${e.level.toUpperCase()}` : "";
    console.log(`[${e.stage}${lvl}] ${e.message}`);
  });

  console.log(`\n${result.status.toUpperCase()} ${JSON.stringify(result.stats)}`);
  if (result.error) console.log(`error: ${result.error}`);

  const updates = db.select().from(schema.hypothesisUpdates).where(eq(schema.hypothesisUpdates.runId, run.id)).all();
  if (updates.length) {
    console.log("\nHypothesis updates:");
    for (const u of updates) {
      const h = db.select().from(schema.hypotheses).where(eq(schema.hypotheses.id, u.hypothesisId)).get()!;
      console.log(`  H${h.id} ${u.change.toUpperCase()} ${u.prevConfidence?.toFixed(2) ?? "–"} → ${u.newConfidence.toFixed(2)} [${h.dimension}]${h.supersedesId ? ` (revises H${h.supersedesId})` : ""}`);
      console.log(`     ${h.statement}`);
      console.log(`     why: ${u.reasoning.slice(0, 300)}${u.reasoning.length > 300 ? "…" : ""}`);
    }
  }
  const insights = db.select().from(schema.insights).where(eq(schema.insights.runId, run.id)).all();
  if (insights.length) {
    console.log("\nInsights:");
    for (const i of insights) console.log(`  [${i.severity}] ${i.title} — ${i.actions.length} action(s)`);
  }
  const questions = db.select().from(schema.openQuestions).where(eq(schema.openQuestions.createdRunId, run.id)).all();
  if (questions.length) {
    console.log("\nNew open questions:");
    for (const q of questions) console.log(`  Q${q.id} ${q.question}`);
  }
  process.exit(result.status === "done" ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
