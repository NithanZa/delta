import { describe, expect, it } from "vitest";
import { createDb } from "@/db";
import { FakeSender } from "@/lib/digest/send";
import { getSetting, setSetting } from "@/lib/settings";
import { budgetStatus, checkBudget } from "./budget";
import { recordUsage } from "./usage";

const now = new Date("2026-11-20T12:00:00.000Z");

function setup(budget = 10) {
  const db = createDb(":memory:");
  setSetting(db, "budget.monthlyUsd", budget);
  setSetting(db, "ops.email", "ops@example.com");
  return db;
}

const spend = (db: ReturnType<typeof createDb>, costUsd: number | null) => recordUsage({ service: "llm", provider: "openai.com", model: "m", task: "synthesize", costUsd }, db);

describe("budgetStatus", () => {
  it("is off without a budget and counts only this calendar month", () => {
    expect(budgetStatus(setup(0), now)).toBeNull();
    const db = setup();
    spend(db, 4);
    spend(db, null);
    const status = budgetStatus(db, now)!;
    expect(status).toMatchObject({ month: "2026-11", spentUsd: 4, unpriced: 1, level: 0 });
    expect(budgetStatus(db, new Date("2099-01-15T00:00:00.000Z"))).toMatchObject({ month: "2099-01", spentUsd: 0 });
  });
});

describe("checkBudget", () => {
  it("emails once at 80% and once at 100%, and never stops anything", async () => {
    const db = setup();
    const sender = new FakeSender();
    spend(db, 7);
    await checkBudget(db, { now, sender });
    expect(sender.sent).toHaveLength(0);

    spend(db, 1.5);
    await checkBudget(db, { now, sender });
    await checkBudget(db, { now, sender });
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].to).toEqual(["ops@example.com"]);
    expect(sender.sent[0].text).toContain("$8.50 of its $10.00");
    expect(sender.sent[0].text).toContain("Nothing has been stopped");

    spend(db, 2);
    await checkBudget(db, { now, sender });
    await checkBudget(db, { now, sender });
    expect(sender.sent).toHaveLength(2);
    expect(sender.sent[1].subject).toContain("105%");
  });

  it("warns about calls with no known price", async () => {
    const db = setup();
    const sender = new FakeSender();
    spend(db, 9);
    spend(db, null);
    await checkBudget(db, { now, sender });
    expect(sender.sent[0].text).toContain("1 call(s) have no known price");
  });

  it("alerts again in a new month", async () => {
    const db = setup();
    const sender = new FakeSender();
    spend(db, 9);
    await checkBudget(db, { now, sender });
    setSetting(db, "budget.lastAlert", "2026-10:100");
    await checkBudget(db, { now, sender });
    expect(sender.sent).toHaveLength(2);
    expect(getSetting(db, "budget.lastAlert")).toBe("2026-11:80");
  });

  it("does not count a failed send or a missing ops address as alerted, so the warning still arrives", async () => {
    const db = setup();
    spend(db, 9);
    await checkBudget(db, { now, sender: new FakeSender("Resend is down") });
    expect(getSetting(db, "budget.lastAlert")).toBeNull();

    setSetting(db, "ops.email", "");
    await checkBudget(db, { now, sender: new FakeSender() });
    expect(getSetting(db, "budget.lastAlert")).toBeNull();

    setSetting(db, "ops.email", "ops@example.com");
    const sender = new FakeSender();
    await checkBudget(db, { now, sender });
    expect(sender.sent).toHaveLength(1);
  });
});
