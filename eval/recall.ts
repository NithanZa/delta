/**
 * Recall against the golden timelines in eval/golden/*.json.
 *
 *   npm run eval:recall -- --db data/demo/delta.demo.db
 *
 * An event counts as found when a fact (statement + quote, dated by its event
 * date or its page) or a timeline event (title + summary) inside the window
 * contains one of the event's keywords. Prints found/total per competitor and
 * the missing events. Exit code 0 regardless: recall is a number to raise, not a gate.
 */
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "@/lib/env";
import { arg } from "./lib/args";
import { openReadOnly } from "./lib/gates";

const Golden = z.object({
  competitor: z.string(),
  events: z.array(
    z.object({
      id: z.string(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      windowDays: z.number().int().positive().default(45),
      anyOf: z.array(z.string()).min(1),
      source: z.string(),
    }),
  ),
});
export type Golden = z.infer<typeof Golden>;

const GOLDEN_DIR = path.resolve(process.cwd(), "eval", "golden");

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const db = openReadOnly(arg("db") ?? env.dbPath);
let grandFound = 0;
let grandTotal = 0;

for (const file of fs.readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".json")).sort()) {
  const golden = Golden.parse(JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, file), "utf8")));
  const comp = db.all<{ id: number; name: string }>(sql`select id, name from competitors where slug = ${golden.competitor}`)[0];
  if (!comp) {
    console.log(`\n## ${golden.competitor}: competitor not in this database (0/${golden.events.length})`);
    grandTotal += golden.events.length;
    continue;
  }
  const facts = db.all<{ id: number; text: string; date: string }>(
    sql`select f.id, f.statement || ' ' || f.quote as text, coalesce(f.event_date, s.published_at) as date from facts f join snapshots s on s.id = f.snapshot_id where f.competitor_id = ${comp.id}`,
  );
  const events = db.all<{ id: number; text: string; date: string }>(
    sql`select id, title || ' ' || summary as text, event_date as date from timeline_events where competitor_id = ${comp.id}`,
  );
  const missing: string[] = [];
  let found = 0;
  for (const ev of golden.events) {
    const from = shiftDays(ev.date, -ev.windowDays);
    const to = shiftDays(ev.date, ev.windowDays);
    const keys = ev.anyOf.map((k) => k.toLowerCase());
    const hit = [...facts.map((f) => ({ ...f, kind: "F" })), ...events.map((e) => ({ ...e, kind: "E" }))].find(
      (r) => r.date >= from && r.date <= to && keys.some((k) => r.text.toLowerCase().includes(k)),
    );
    if (hit) found++;
    else missing.push(`${ev.id} (${ev.date}): ${ev.anyOf[0]} — ${ev.source}`);
  }
  grandFound += found;
  grandTotal += golden.events.length;
  console.log(`\n## ${comp.name}: ${found}/${golden.events.length} golden events found`);
  for (const m of missing) console.log(`  missing ${m}`);
}

console.log(`\nRecall: ${grandFound}/${grandTotal}${grandTotal ? ` (${Math.round((100 * grandFound) / grandTotal)}%)` : ""}`);
