/**
 * Typed key/value settings stored in the `settings` table, with defaults.
 * The worker reads the schedule from here; the UI edits it.
 */
import { Cron } from "croner";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { env } from "@/lib/env";

export type SettingValues = {
  "schedule.timezone": string;
  "schedule.crawlCron": string;
  "schedule.runCron": string;
  "schedule.digestCron": string;
  "schedule.discoveryCron": string;
  /** ISO timestamp written by the worker every minute. */
  "worker.heartbeatAt": string | null;
  /** Digest recipients. */
  "digest.to": string[];
  /** e.g. "Delta <delta@notify.example.com>" (a verified Resend sending domain). */
  "digest.from": string;
  /** Public base URL used in links; defaults to DELTA_BASE_URL. */
  "app.baseUrl": string;
  /** Optional Slack incoming webhook; empty = no Slack post. */
  "slack.webhookUrl": string;
  /** Where held/failed digests and budget alerts are reported. */
  "ops.email": string;
  /** Alert the operator as monthly spend nears this many US dollars; 0 turns the alert off. It never stops work. */
  "budget.monthlyUsd": number;
  /** The last alert sent, as "YYYY-MM:percent", so each level is sent once a month. */
  "budget.lastAlert": string | null;
  "discovery.enabled": boolean;
  "discovery.maxNewPagesPerRun": number;
  "discovery.lookbackDays": number;
  /** Never discover from these hosts (social networks are costly, restrictive and noisy). */
  "discovery.blockedDomains": string[];
};
export type SettingKey = keyof SettingValues;

export const SETTING_DEFAULTS: SettingValues = {
  "schedule.timezone": process.env.TZ || "UTC",
  "schedule.crawlCron": "0 3 * * *",
  "schedule.runCron": "0 5 * * MON",
  "schedule.digestCron": "0 8 * * MON",
  "schedule.discoveryCron": "0 4 * * MON",
  "worker.heartbeatAt": null,
  "digest.to": [],
  "digest.from": env.digestFrom || "Delta <delta@localhost>",
  "app.baseUrl": env.baseUrl,
  "slack.webhookUrl": "",
  "ops.email": "",
  "budget.monthlyUsd": 0,
  "budget.lastAlert": null,
  "discovery.enabled": true,
  "discovery.maxNewPagesPerRun": 10,
  "discovery.lookbackDays": 14,
  "discovery.blockedDomains": ["x.com", "twitter.com", "facebook.com", "instagram.com", "tiktok.com", "pinterest.com", "youtube.com", "reddit.com"],
};

export function getSetting<K extends SettingKey>(db: Db, key: K): SettingValues[K] {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  return row === undefined ? SETTING_DEFAULTS[key] : (row.value as SettingValues[K]);
}

export function setSetting<K extends SettingKey>(db: Db, key: K, value: SettingValues[K]): void {
  // A JSON column cannot hold SQL NULL; a null setting simply falls back to its default.
  if (value === null) {
    db.delete(schema.settings).where(eq(schema.settings.key, key)).run();
    return;
  }
  db.insert(schema.settings)
    .values({ key, value, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date().toISOString() } })
    .run();
}

export type Schedule = {
  timezone: string;
  crawlCron: string;
  runCron: string;
  digestCron: string;
  discoveryCron: string;
};

export function getSchedule(db: Db): Schedule {
  return {
    timezone: getSetting(db, "schedule.timezone"),
    crawlCron: getSetting(db, "schedule.crawlCron"),
    runCron: getSetting(db, "schedule.runCron"),
    digestCron: getSetting(db, "schedule.digestCron"),
    discoveryCron: getSetting(db, "schedule.discoveryCron"),
  };
}

/** Error message when a cron pattern is invalid, else null. */
export function validateCron(pattern: string, timezone?: string): string | null {
  try {
    const job = new Cron(pattern, { paused: true, timezone });
    const next = job.nextRun();
    job.stop();
    return next ? null : "pattern never fires";
  } catch (e) {
    return (e as Error).message.replace(/^CronPattern: /, "");
  }
}

export function validateTimezone(tz: string): string | null {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return null;
  } catch {
    return `Unknown IANA timezone "${tz}"`;
  }
}

/** Next firing time for a pattern, or null when invalid. */
export function nextCronRun(pattern: string, timezone: string): Date | null {
  try {
    const job = new Cron(pattern, { paused: true, timezone });
    const next = job.nextRun();
    job.stop();
    return next;
  } catch {
    return null;
  }
}
