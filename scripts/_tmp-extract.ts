import fs from "node:fs";
import { extractReadable } from "@/lib/ingest/extract";
for (const f of process.argv.slice(2)) {
  const html = fs.readFileSync(f, "utf8");
  const e = extractReadable(html, "https://www.socialpilot.co/pricing");
  const prices = (e.text.match(/\$\d+/g) ?? []).slice(0, 12).join(" ");
  console.log(`${f}: ${e.text.length} chars | title=${e.title} | prices: ${prices}`);
}
