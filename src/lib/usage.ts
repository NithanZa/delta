/**
 * The spend ledger: every paid model and Exa call, recorded where the call is
 * made so nothing depends on the caller remembering (see /usage).
 */
import { desc, gte, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { getDb, schema } from "@/db";
import type { UsageEvent } from "@/db/schema";

export type UsageEntry = Pick<UsageEvent, "service" | "provider" | "model" | "task" | "costUsd"> & Partial<Pick<UsageEvent, "promptTokens" | "completionTokens" | "cacheReadTokens" | "cacheWriteTokens">>;

/** The call has already been paid for: a ledger problem must never lose its result. */
export function recordUsage(entry: UsageEntry, db?: Db): void {
  try {
    (db ?? getDb()).insert(schema.usageEvents).values(entry).run();
  } catch (e) {
    console.warn(`Could not record usage for ${entry.provider} ${entry.model}: ${(e as Error).message}`);
  }
}

export type UsageTotal = { usd: number; calls: number; unpriced: number; promptTokens: number; completionTokens: number };

const totalColumns = {
  usd: sql<number>`coalesce(sum(${schema.usageEvents.costUsd}), 0)`,
  calls: sql<number>`count(*)`,
  unpriced: sql<number>`coalesce(sum(${schema.usageEvents.costUsd} is null), 0)`,
  promptTokens: sql<number>`coalesce(sum(${schema.usageEvents.promptTokens}), 0)`,
  completionTokens: sql<number>`coalesce(sum(${schema.usageEvents.completionTokens}), 0)`,
};

const since = (iso: string | null): SQL | undefined => (iso ? gte(schema.usageEvents.createdAt, iso) : undefined);
const emptyTotal: UsageTotal = { usd: 0, calls: 0, unpriced: 0, promptTokens: 0, completionTokens: 0 };

export type UsagePeriod = { label: string; total: UsageTotal; llm: UsageTotal; exa: UsageTotal };
export type UsageGroup = UsageTotal & { service: "llm" | "exa"; provider: string; model: string };

export type UsageReport = {
  periods: UsagePeriod[];
  days: (UsageTotal & { day: string; llmUsd: number; exaUsd: number })[];
  byModel: UsageGroup[];
  byTask: (UsageTotal & { service: "llm" | "exa"; task: string })[];
  recent: UsageEvent[];
  firstAt: string | null;
};

const DAYS_SHOWN = 14;

/** Day boundaries are UTC, the same clock the rows are stamped with. */
export function usageReport(db: Db, now = new Date()): UsageReport {
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
  const t = schema.usageEvents;

  const period = (label: string, start: string | null): UsagePeriod => {
    const rows = db.select({ service: t.service, ...totalColumns }).from(t).where(since(start)).groupBy(t.service).all();
    const llm = rows.find((r) => r.service === "llm") ?? emptyTotal;
    const exa = rows.find((r) => r.service === "exa") ?? emptyTotal;
    const total = {
      usd: llm.usd + exa.usd,
      calls: llm.calls + exa.calls,
      unpriced: llm.unpriced + exa.unpriced,
      promptTokens: llm.promptTokens + exa.promptTokens,
      completionTokens: llm.completionTokens + exa.completionTokens,
    };
    return { label, total, llm, exa };
  };

  const day = sql<string>`substr(${t.createdAt}, 1, 10)`;
  const windowStart = daysAgo(30);
  return {
    periods: [period("Today (UTC)", `${now.toISOString().slice(0, 10)}T00:00:00.000Z`), period("Last 7 days", daysAgo(7)), period("Last 30 days", windowStart), period("All time", null)],
    days: db
      .select({ day, ...totalColumns, llmUsd: sql<number>`coalesce(sum(case when ${t.service} = 'llm' then ${t.costUsd} end), 0)`, exaUsd: sql<number>`coalesce(sum(case when ${t.service} = 'exa' then ${t.costUsd} end), 0)` })
      .from(t)
      .groupBy(day)
      .orderBy(desc(day))
      .limit(DAYS_SHOWN)
      .all(),
    byModel: db.select({ service: t.service, provider: t.provider, model: t.model, ...totalColumns }).from(t).where(since(windowStart)).groupBy(t.service, t.provider, t.model).orderBy(desc(totalColumns.usd)).all(),
    byTask: db.select({ service: t.service, task: t.task, ...totalColumns }).from(t).where(since(windowStart)).groupBy(t.service, t.task).orderBy(desc(totalColumns.usd)).all(),
    recent: db.select().from(t).orderBy(desc(t.id)).limit(30).all(),
    firstAt: db.select({ at: sql<string | null>`min(${t.createdAt})` }).from(t).get()?.at ?? null,
  };
}
