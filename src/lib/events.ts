/**
 * Instrumentation events. The success signal for the pilot is a verified
 * `decision_influenced`; the others show the funnel that leads there.
 */
import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { EventName, EventRow } from "@/db/schema";

export function recordEvent(db: Db, name: EventName, props: Record<string, unknown> = {}): EventRow {
  return db.insert(schema.events).values({ name, props }).returning().get();
}

export function listEvents(db: Db, name?: EventName, limit = 200): EventRow[] {
  const q = db.select().from(schema.events);
  return (name ? q.where(eq(schema.events.name, name)) : q).orderBy(desc(schema.events.id)).limit(limit).all();
}

export type WeekFunnel = { week: string; sent: number; reacted: number; replied: number; decided: number };

/** Monday of the ISO week containing a timestamp. */
export function weekOf(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

/** digests sent → reaction clicks → replies → decisions, per week, newest first. */
export function funnelByWeek(db: Db): WeekFunnel[] {
  const weeks = new Map<string, WeekFunnel>();
  const column: Partial<Record<EventName, keyof Omit<WeekFunnel, "week">>> = { digest_sent: "sent", insight_reacted: "reacted", reply_received: "replied", decision_influenced: "decided" };
  for (const e of db.select({ name: schema.events.name, createdAt: schema.events.createdAt }).from(schema.events).all()) {
    const key = column[e.name];
    if (!key) continue;
    const week = weekOf(e.createdAt);
    const row = weeks.get(week) ?? { week, sent: 0, reacted: 0, replied: 0, decided: 0 };
    row[key] += 1;
    weeks.set(week, row);
  }
  return [...weeks.values()].sort((a, b) => b.week.localeCompare(a.week));
}

export function countEvents(db: Db): Record<EventName, number> {
  const rows = db.select({ name: schema.events.name }).from(schema.events).all();
  const counts = { digest_sent: 0, insight_viewed: 0, insight_reacted: 0, insight_corrected: 0, source_added: 0, reply_received: 0, decision_influenced: 0 } as Record<EventName, number>;
  for (const r of rows) counts[r.name] += 1;
  return counts;
}
