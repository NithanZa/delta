/**
 * Smoke-test the configured models for both roles.
 *
 *   npm run llm:smoke
 *
 * Prints provider, model, token usage (including cache reads) and the
 * estimated cost per role. Exits non-zero when a call fails.
 */
import { z } from "zod";
import { callJson, type LlmRole } from "@/lib/llm/client";
import { getLlmConfig } from "@/lib/llm/config";
import { estimateCostUsd } from "@/lib/llm/pricing";

const Smoke = z.object({ ok: z.boolean(), model: z.string() });
const SmokeWire = z.object({ ok: z.boolean(), model: z.string() });

async function smoke(role: LlmRole) {
  const cfg = getLlmConfig().roles[role];
  const t0 = Date.now();
  const res = await callJson({
    task: "smoke",
    role,
    system: "You are a connectivity check. Reply with JSON only.",
    user: 'Return {"ok": true, "model": "<the model name you believe you are>"} and nothing else.',
    schema: Smoke,
    wire: SmokeWire,
    maxTokens: 2048,
  });
  const cost = estimateCostUsd(cfg.model, res.usage);
  console.log(
    `${role.padEnd(10)} ${cfg.provider}:${cfg.model} effort=${cfg.effort} → ok=${res.data.ok} self="${res.data.model}" · ${res.usage.promptTokens} in (${res.usage.cacheReadTokens ?? 0} cached, ${res.usage.cacheWriteTokens ?? 0} written) / ${res.usage.completionTokens} out · ${cost == null ? "cost n/a" : `≈$${cost.toFixed(5)}`} · ${Date.now() - t0} ms · ${res.attempts} attempt(s)`,
  );
}

async function main() {
  let failed = false;
  for (const role of ["extract", "synthesize"] as const) {
    try {
      await smoke(role);
    } catch (e) {
      failed = true;
      console.error(`${role.padEnd(10)} FAILED: ${(e as Error).message}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

main();
