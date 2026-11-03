/**
 * Render or send the weekly digest from the command line.
 *
 *   npm run digest -- --preview [--since YYYY-MM-DD]   # writes data/digests/preview-<date>.html, sends nothing
 *   npm run digest -- --send [--since YYYY-MM-DD]      # sends through Resend to digest.to
 */
import { createDb } from "@/db";
import { env } from "@/lib/env";
import { runDigestJob } from "@/lib/digest/job";
import { ResendSender } from "@/lib/digest/send";

const flag = (name: string) => process.argv.includes(`--${name}`);
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

async function main() {
  const db = createDb(env.dbPath);
  const sinceArg = arg("since");
  const since = sinceArg ? (sinceArg.length === 10 ? `${sinceArg}T00:00:00.000Z` : sinceArg) : undefined;
  const log = (m: string) => console.log(m);
  if (flag("preview")) {
    const r = await runDigestJob(db, { preview: true, since, log });
    process.exit(r.reasons.length ? 2 : 0);
  }
  if (flag("send")) {
    const r = await runDigestJob(db, { since, sender: new ResendSender(), log });
    console.log(`result: ${r.status}${r.reasons.length ? ` (${r.reasons.join("; ")})` : ""}`);
    process.exit(r.status === "sent" || r.status === "noop" ? 0 : 1);
  }
  console.error("Usage: npm run digest -- --preview | --send [--since YYYY-MM-DD]");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
