/**
 * A monthly spend alert. Hosting absorbs the model bill, so the operator wants
 * warning before a surprise, but a partner's digest must never stop over it:
 * this module only ever tells someone.
 */
import { gte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { notifyOps } from "@/lib/digest/job";
import { ResendSender, type EmailSender } from "@/lib/digest/send";
import { getSetting, setSetting } from "@/lib/settings";

export type BudgetStatus = { month: string; budgetUsd: number; spentUsd: number; unpriced: number; percent: number; level: 0 | 80 | 100 };

/** This calendar month (UTC, the clock usage rows are stamped with) against the budget; null when no budget is set. */
export function budgetStatus(db: Db, now = new Date()): BudgetStatus | null {
  const budgetUsd = getSetting(db, "budget.monthlyUsd");
  if (budgetUsd <= 0) return null;
  const month = now.toISOString().slice(0, 7);
  const t = schema.usageEvents;
  const row = db
    .select({ usd: sql<number>`coalesce(sum(${t.costUsd}), 0)`, unpriced: sql<number>`coalesce(sum(${t.costUsd} is null), 0)` })
    .from(t)
    .where(gte(t.createdAt, `${month}-01T00:00:00.000Z`))
    .get();
  const spentUsd = row?.usd ?? 0;
  const percent = (spentUsd / budgetUsd) * 100;
  return { month, budgetUsd, spentUsd, unpriced: row?.unpriced ?? 0, percent, level: percent >= 100 ? 100 : percent >= 80 ? 80 : 0 };
}

function alertedLevel(db: Db, month: string): number {
  const [alertMonth, level] = (getSetting(db, "budget.lastAlert") ?? "").split(":");
  return alertMonth === month ? Number(level) : 0;
}

/**
 * Email ops the first time spend crosses 80% and 100% in a month. A level is
 * only marked as alerted once the email went out, so an ops address added later
 * or a failed send still gets the warning on the next check.
 */
export async function checkBudget(db: Db, opts: { now?: Date; sender?: EmailSender; log?: (m: string) => void } = {}): Promise<BudgetStatus | null> {
  const log = opts.log ?? (() => {});
  const status = budgetStatus(db, opts.now);
  if (!status || status.level <= alertedLevel(db, status.month) || !getSetting(db, "ops.email")) return status;
  const spent = `$${status.spentUsd.toFixed(2)}`;
  const budget = `$${status.budgetUsd.toFixed(2)}`;
  const unpriced = status.unpriced ? ` The real figure is higher: ${status.unpriced} call(s) have no known price.` : "";
  const sent = await notifyOps(
    db,
    opts.sender ?? new ResendSender(),
    `Delta spend: ${Math.floor(status.percent)}% of the ${status.month} budget`,
    `Delta has spent an estimated ${spent} of its ${budget} budget this month.${unpriced}\n\nNothing has been stopped: runs and digests carry on. See where the money went at ${getSetting(db, "app.baseUrl")}/usage`,
    log,
  );
  if (sent) {
    setSetting(db, "budget.lastAlert", `${status.month}:${status.level}`);
    log(`budget alert sent: ${spent} of ${budget}`);
  }
  return status;
}
