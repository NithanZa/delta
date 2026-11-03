/**
 * Check that this instance is configured: environment, database write, models,
 * Exa, Resend and the public URL. Exits 1 when a required check fails.
 *
 *   npm run doctor
 *   npm run doctor -- --offline   # skip checks that call a provider
 *   npm run doctor -- --send-test # also send from digest.from to Resend's test inbox
 */
import { Resend } from "resend";
import { z } from "zod";
import { createDb } from "@/db";
import { env } from "@/lib/env";
import { exaSearch } from "@/lib/ingest/exa";
import { callJson, type LlmRole } from "@/lib/llm/client";
import { getLlmConfig } from "@/lib/llm/config";
import { getSetting, setSetting } from "@/lib/settings";

type Status = "OK" | "WARN" | "FAIL" | "SKIP";
const rows: { name: string; status: Status; detail: string; required: boolean }[] = [];
const add = (name: string, status: Status, detail: string, required = true) => rows.push({ name, status, detail, required });
const offline = process.argv.includes("--offline");
const sendTest = process.argv.includes("--send-test");
/** Resend's test inbox: accepts mail and delivers it to no one. */
const RESEND_TEST_INBOX = "delivered@resend.dev";

async function main() {
  // Database write
  let db: ReturnType<typeof createDb> | undefined;
  try {
    db = createDb(env.dbPath);
    const before = getSetting(db, "worker.heartbeatAt");
    setSetting(db, "worker.heartbeatAt", new Date().toISOString());
    setSetting(db, "worker.heartbeatAt", before);
    add("Database", "OK", `${env.dbPath} is writable and migrated`);
  } catch (e) {
    add("Database", "FAIL", (e as Error).message);
  }

  // Public URL and link secret
  const baseUrl = db ? getSetting(db, "app.baseUrl") : env.baseUrl;
  if (/^https:\/\//.test(baseUrl)) add("Base URL", "OK", baseUrl);
  else add("Base URL", "WARN", `${baseUrl}: set DELTA_BASE_URL to the public https URL; links in emails use it`);
  if (env.linkSecret === "dev-only-change-me") add("Link secret", "WARN", "DELTA_LINK_SECRET is unset; signed links are refused in production (openssl rand -base64 32)");
  else add("Link secret", "OK", "set");

  // Models
  const cfg = getLlmConfig();
  for (const role of ["extract", "synthesize"] as LlmRole[]) {
    const r = cfg.roles[role];
    const label = `Model (${role})`;
    if (offline) {
      add(label, "SKIP", `${r.provider}:${r.model}`);
      continue;
    }
    try {
      const res = await callJson({ task: "smoke", role, system: "You are a connectivity check. Reply with JSON only.", user: 'Return {"ok": true}.', schema: z.object({ ok: z.boolean() }), wire: z.object({ ok: z.boolean() }), maxTokens: 2048 });
      add(label, res.data.ok ? "OK" : "FAIL", `${r.provider}:${r.model}, ${res.usage.promptTokens}+${res.usage.completionTokens} tokens`);
    } catch (e) {
      add(label, "FAIL", `${r.provider}:${r.model}: ${(e as Error).message.slice(0, 160)}`);
    }
  }

  // Exa (discovery is optional)
  if (!env.exaApiKey) add("Exa", "WARN", "EXA_API_KEY unset; off-domain discovery is off, absence checks still probe own paths", false);
  else if (offline) add("Exa", "SKIP", "key present", false);
  else {
    try {
      await exaSearch({ query: "competitive intelligence", numResults: 1 }, { task: "doctor" });
      add("Exa", "OK", "search responded", false);
    } catch (e) {
      add("Exa", "FAIL", (e as Error).message.slice(0, 160), false);
    }
  }

  // Resend (the digest cannot be sent without it)
  let sendOnlyKey = false;
  if (!env.resendApiKey) add("Resend", "FAIL", "RESEND_API_KEY unset; digests cannot be sent");
  else if (offline) add("Resend", "SKIP", "key present");
  else {
    try {
      const resend = new Resend(env.resendApiKey);
      const { data, error } = await resend.domains.list();
      sendOnlyKey = error?.name === "restricted_api_key";
      if (error && !sendOnlyKey) throw new Error(error.message);
      if (sendOnlyKey) {
        add("Resend", "OK", sendTest ? "send-only key" : "send-only key, so domains cannot be listed; --send-test proves the From address works");
      } else {
        const domains = data?.data ?? [];
        const verified = domains.filter((d) => d.status === "verified").map((d) => d.name);
        add("Resend", verified.length ? "OK" : "WARN", verified.length ? `verified: ${verified.join(", ")}` : `no verified domain yet (${domains.length} configured)`);
      }
      if (sendTest && db) {
        const from = getSetting(db, "digest.from");
        const sent = await resend.emails.send({ from, to: [RESEND_TEST_INBOX], subject: "Delta doctor: send test", text: "Sent by npm run doctor -- --send-test." });
        if (sent.error) add("Send test", "FAIL", `${from}: ${sent.error.message.slice(0, 160)}`);
        else add("Send test", "OK", `${from} → ${RESEND_TEST_INBOX} (${sent.data?.id})`);
      }
    } catch (e) {
      add("Resend", "FAIL", (e as Error).message.slice(0, 160));
    }
  }

  // Delivery settings
  if (db) {
    const from = getSetting(db, "digest.from");
    add("From address", /<[^@>]+@(?!localhost>)[^>]+>/.test(from) ? "OK" : "WARN", `${from}; use "Delta <address>" on a verified domain`, false);
    const to = getSetting(db, "digest.to");
    add("Digest recipients", to.length ? "OK" : "WARN", to.length ? to.join(", ") : "digest.to is empty; set it in Settings", false);
    const heartbeat = getSetting(db, "worker.heartbeatAt");
    const alive = heartbeat && Date.now() - new Date(heartbeat).getTime() < 3 * 60_000;
    add("Worker", alive ? "OK" : "WARN", alive ? `heartbeat ${heartbeat}` : "no recent heartbeat; is the worker running?", false);
  }

  const width = Math.max(...rows.map((r) => r.name.length));
  for (const r of rows) console.log(`${r.status.padEnd(4)}  ${r.name.padEnd(width)}  ${r.detail}`);
  const failed = rows.filter((r) => r.status === "FAIL" && r.required);
  console.log(failed.length ? `\n${failed.length} required check(s) failed.` : "\nNo required check failed.");
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
