/**
 * Regression suite: runs eval/cases/*.json against the configured models.
 *
 *   npm run eval:regress
 *   npm run eval:regress -- --only E01,E05 --kind extract
 *
 * Writes eval/results/regress-<timestamp>.json and exits 1 while any case fails.
 * Refuses to run with DELTA_MOCK_LLM=1: the suite only means something against
 * real models (cases with a `mock` block are deterministic regardless).
 */
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";
import { emptyUsage, addUsage, type LlmRole, type LlmUsage } from "@/lib/llm/client";
import { getLlmConfig } from "@/lib/llm/config";
import { estimateRunCostUsd } from "@/lib/llm/pricing";
import { arg, list } from "./lib/args";
import { loadCases } from "./lib/cases";
import { runCase, type CaseResult } from "./lib/harness";

async function main() {
  if (env.mockLlm) {
    console.error("eval:regress refuses to run with DELTA_MOCK_LLM=1 — unset it so the configured models are used.");
    process.exit(2);
  }
  const only = list("only");
  const kind = arg("kind");
  let cases = loadCases();
  if (only) cases = cases.filter((c) => only.some((o) => c.id === o || c.id.startsWith(o)));
  if (kind) cases = cases.filter((c) => c.kind === kind);
  if (cases.length === 0) {
    console.error("No cases selected.");
    process.exit(2);
  }
  const cfg = getLlmConfig();
  console.log(`Running ${cases.length} case(s) with extract=${cfg.roles.extract.provider}:${cfg.roles.extract.model}, synthesize=${cfg.roles.synthesize.provider}:${cfg.roles.synthesize.model}\n`);

  const results: CaseResult[] = [];
  const total: Record<LlmRole, LlmUsage> = { extract: emptyUsage(), synthesize: emptyUsage() };
  for (const c of cases) {
    process.stdout.write(`${c.id.padEnd(5)} ${c.kind.padEnd(9)} … `);
    const r = await runCase(c);
    results.push(r);
    addUsage(total.extract, r.usage.extract);
    addUsage(total.synthesize, r.usage.synthesize);
    console.log(`${r.pass ? "PASS" : "FAIL"} (${Math.round(r.durationMs / 1000)}s${r.mocked ? ", mock" : ""})`);
    for (const f of r.failures) console.log(`      ✗ ${f}`);
    if (r.excerpt) console.log(`      → ${r.excerpt.slice(0, 400)}`);
  }

  const passed = results.filter((r) => r.pass).length;
  console.log("\n| Case | Kind | Result | Failures |");
  console.log("|---|---|---|---|");
  for (const r of results) console.log(`| ${r.id} | ${r.kind} | ${r.pass ? "PASS" : "FAIL"} | ${r.failures.length ? r.failures[0].slice(0, 120).replace(/\|/g, "/") : ""} |`);
  const cost = estimateRunCostUsd(total, cfg);
  console.log(
    `\n${passed}/${results.length} passed · tokens extract ${total.extract.promptTokens}+${total.extract.completionTokens}, synthesize ${total.synthesize.promptTokens}+${total.synthesize.completionTokens} · estimated cost ${cost == null ? "n/a (no list price for a configured model)" : `$${cost.toFixed(3)}`}`,
  );

  const outDir = path.resolve(process.cwd(), "eval", "results");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `regress-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), models: cfg.roles, passed, total: results.length, costUsd: cost, results }, null, 2));
  console.log(`Results written to ${path.relative(process.cwd(), out)}`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
