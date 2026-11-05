"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { and, eq as eqOp } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { FEED_KINDS, SOURCE_TYPES } from "@/db/schema";
import { domainFromWebsite, proposeWatchlist, type WatchlistProposal } from "@/lib/ingest/watchlist";
import { setSetting, SETTING_DEFAULTS, validateCron, validateTimezone } from "@/lib/settings";

const CompanyInput = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().trim().default(""),
  product: z.string().trim().default(""),
  targetCustomers: z.string().trim().default(""),
  positioning: z.string().trim().default(""),
  priorities: z.string().trim().default(""),
  constraints: z.string().trim().default(""),
});

export type SettingsState = { ok: boolean; message: string };

export async function saveCompany(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const parsed = CompanyInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => i.message).join(", ") };
  const db = getDb();
  const existing = db.select().from(schema.company).get();
  if (existing) db.update(schema.company).set({ ...parsed.data, updatedAt: new Date().toISOString() }).where(eq(schema.company.id, existing.id)).run();
  else db.insert(schema.company).values(parsed.data).run();
  revalidatePath("/");
  revalidatePath("/settings");
  return { ok: true, message: "Saved" };
}

const QuestionsInput = z.object({
  competitorId: z.coerce.number().int(),
  questions: z.string(),
});

function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export async function saveQuestions(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const parsed = QuestionsInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Invalid input" };
  const lines = splitLines(parsed.data.questions);
  const db = getDb();
  db.delete(schema.researchQuestions).where(eq(schema.researchQuestions.competitorId, parsed.data.competitorId)).run();
  if (lines.length) db.insert(schema.researchQuestions).values(lines.map((text) => ({ competitorId: parsed.data.competitorId, text }))).run();
  revalidatePath("/");
  revalidatePath("/settings");
  revalidatePath("/c/[slug]", "page");
  return { ok: true, message: `Saved ${lines.length} question${lines.length === 1 ? "" : "s"}` };
}

/** kebab-case: "Later.com " → "later-com". Empty when the name has no letters or digits. */
function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Accept "later.com" as well as "https://later.com"; reject anything that is not a URL. */
const Website = z
  .string()
  .trim()
  .default("")
  .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
  .refine(
    (v) => {
      if (!v) return true;
      try {
        return Boolean(new URL(v).hostname);
      } catch {
        return false;
      }
    },
    { message: "Website must be a valid URL" },
  );

const CompetitorInput = z.object({
  name: z.string().trim().min(1, "Name is required"),
  website: Website,
  description: z.string().trim().default(""),
  questions: z.string().default(""),
});

export type AddCompetitorState = SettingsState & { slug?: string };

export async function addCompetitor(_prev: AddCompetitorState, formData: FormData): Promise<AddCompetitorState> {
  const parsed = CompetitorInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => i.message).join(", ") };
  const { name, website, description } = parsed.data;
  const slug = slugify(name);
  if (!slug) return { ok: false, message: "Name must contain at least one letter or digit" };

  const db = getDb();
  const taken = db.select({ id: schema.competitors.id, name: schema.competitors.name }).from(schema.competitors).where(eq(schema.competitors.slug, slug)).get();
  if (taken) return { ok: false, message: `"${taken.name}" already uses the slug "${slug}". Pick a different name.` };

  const questions = splitLines(parsed.data.questions);
  const row = db.transaction((tx) => {
    const competitor = tx.insert(schema.competitors).values({ name, slug, website, description, domain: domainFromWebsite(website) }).returning().get();
    if (questions.length) tx.insert(schema.researchQuestions).values(questions.map((text) => ({ competitorId: competitor.id, text }))).run();
    return competitor;
  });

  revalidatePath("/");
  revalidatePath("/settings");
  return { ok: true, message: `Added ${row.name} with ${questions.length} question${questions.length === 1 ? "" : "s"}`, slug: row.slug };
}

const CompetitorDetailsInput = z.object({
  competitorId: z.coerce.number().int(),
  website: Website,
  description: z.string().trim().default(""),
});

export async function saveCompetitorDetails(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const parsed = CompetitorDetailsInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => i.message).join(", ") };
  const { competitorId, website, description } = parsed.data;
  const db = getDb();
  const existing = db.select({ id: schema.competitors.id }).from(schema.competitors).where(eq(schema.competitors.id, competitorId)).get();
  if (!existing) return { ok: false, message: "Competitor not found" };
  db.update(schema.competitors).set({ website, description, domain: domainFromWebsite(website) }).where(eq(schema.competitors.id, competitorId)).run();
  revalidatePath("/");
  revalidatePath("/settings");
  revalidatePath("/c/[slug]", "page");
  return { ok: true, message: "Saved" };
}

// ── Watchlist and feeds (phase 4) ────────────────────────────────────────────

function revalidateAll() {
  revalidatePath("/");
  revalidatePath("/settings");
  revalidatePath("/c/[slug]", "page");
}

const SourceUpdate = z.object({
  sourceId: z.coerce.number().int(),
  watch: z.string().optional(),
  enabled: z.string().optional(),
  checkIntervalHours: z.coerce.number().int().min(1).max(24 * 90).default(168),
});

export async function updateSource(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const p = SourceUpdate.safeParse(Object.fromEntries(formData));
  if (!p.success) return { ok: false, message: "Invalid input" };
  const res = getDb()
    .update(schema.sources)
    .set({ watch: p.data.watch === "on", enabled: p.data.enabled === "on", checkIntervalHours: p.data.checkIntervalHours })
    .where(eqOp(schema.sources.id, p.data.sourceId))
    .run();
  if (res.changes === 0) return { ok: false, message: "Page not found" };
  revalidateAll();
  return { ok: true, message: "Saved" };
}

const WatchSourceInput = z.object({ competitorId: z.coerce.number().int(), url: Website, sourceType: z.enum(SOURCE_TYPES).default("website") });

/** Add a page to the watchlist without fetching it now; the next crawl fetches it. */
export async function addWatchSource(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const p = WatchSourceInput.safeParse(Object.fromEntries(formData));
  if (!p.success || !p.data.url) return { ok: false, message: "Enter a valid http(s) URL" };
  const db = getDb();
  const existing = db
    .select()
    .from(schema.sources)
    .where(and(eqOp(schema.sources.competitorId, p.data.competitorId), eqOp(schema.sources.url, p.data.url)))
    .get();
  if (existing) db.update(schema.sources).set({ watch: true, enabled: true }).where(eqOp(schema.sources.id, existing.id)).run();
  else db.insert(schema.sources).values({ competitorId: p.data.competitorId, url: p.data.url, sourceType: p.data.sourceType, provider: "watchlist", watch: true }).run();
  revalidateAll();
  return { ok: true, message: existing ? "Now watching this page" : "Added; the next crawl fetches it" };
}

const FeedInput = z.object({ competitorId: z.coerce.number().int(), url: Website, kind: z.enum(FEED_KINDS).default("rss") });

export async function addFeed(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const p = FeedInput.safeParse(Object.fromEntries(formData));
  if (!p.success || !p.data.url) return { ok: false, message: "Enter a valid http(s) URL" };
  const db = getDb();
  const existing = db.select().from(schema.feeds).where(and(eqOp(schema.feeds.competitorId, p.data.competitorId), eqOp(schema.feeds.url, p.data.url))).get();
  if (existing) {
    db.update(schema.feeds).set({ enabled: true, kind: p.data.kind }).where(eqOp(schema.feeds.id, existing.id)).run();
  } else {
    db.insert(schema.feeds).values({ competitorId: p.data.competitorId, url: p.data.url, kind: p.data.kind }).run();
  }
  revalidateAll();
  return { ok: true, message: existing ? "Feed re-enabled" : "Feed added; the next crawl polls it" };
}

const FeedToggle = z.object({ feedId: z.coerce.number().int(), enabled: z.enum(["0", "1"]) });

export async function setFeedEnabled(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const p = FeedToggle.safeParse(Object.fromEntries(formData));
  if (!p.success) return { ok: false, message: "Invalid input" };
  getDb().update(schema.feeds).set({ enabled: p.data.enabled === "1" }).where(eqOp(schema.feeds.id, p.data.feedId)).run();
  revalidateAll();
  return { ok: true, message: p.data.enabled === "1" ? "Enabled" : "Disabled" };
}

export type ProposalState = SettingsState & { proposal?: WatchlistProposal };

/** Probe the competitor's site for pages, feeds and sitemaps worth watching. */
export async function proposeWatchlistAction(_prev: ProposalState, formData: FormData): Promise<ProposalState> {
  const competitorId = Number(formData.get("competitorId"));
  const competitor = getDb().select().from(schema.competitors).where(eqOp(schema.competitors.id, competitorId)).get();
  if (!competitor) return { ok: false, message: "Competitor not found" };
  if (!competitor.website) return { ok: false, message: "Set the competitor's website first" };
  try {
    const proposal = await proposeWatchlist(competitor.website);
    return { ok: true, message: `Found ${proposal.pages.length} page(s) and ${proposal.feeds.length} feed(s)`, proposal };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** Add the ticked proposal rows: "url|sourceType" pages and "url|kind" feeds. */
export async function addProposed(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const competitorId = Number(formData.get("competitorId"));
  if (!Number.isInteger(competitorId)) return { ok: false, message: "Invalid input" };
  const db = getDb();
  let pages = 0;
  let feeds = 0;
  for (const v of formData.getAll("page")) {
    const [url, sourceType] = String(v).split("|");
    const type = (SOURCE_TYPES as readonly string[]).includes(sourceType) ? (sourceType as (typeof SOURCE_TYPES)[number]) : "website";
    if (!/^https?:\/\//.test(url)) continue;
    const existing = db.select().from(schema.sources).where(and(eqOp(schema.sources.competitorId, competitorId), eqOp(schema.sources.url, url))).get();
    if (existing) db.update(schema.sources).set({ watch: true, enabled: true }).where(eqOp(schema.sources.id, existing.id)).run();
    else db.insert(schema.sources).values({ competitorId, url, sourceType: type, provider: "watchlist", watch: true }).run();
    pages++;
  }
  for (const v of formData.getAll("feed")) {
    const [url, kind] = String(v).split("|");
    if (!/^https?:\/\//.test(url) || !(FEED_KINDS as readonly string[]).includes(kind)) continue;
    const existing = db.select().from(schema.feeds).where(and(eqOp(schema.feeds.competitorId, competitorId), eqOp(schema.feeds.url, url))).get();
    if (existing) db.update(schema.feeds).set({ enabled: true }).where(eqOp(schema.feeds.id, existing.id)).run();
    else db.insert(schema.feeds).values({ competitorId, url, kind: kind as (typeof FEED_KINDS)[number] }).run();
    feeds++;
  }
  revalidateAll();
  return { ok: true, message: `Watching ${pages} page(s) and ${feeds} feed(s)` };
}

// ── Schedule (phase 5) ───────────────────────────────────────────────────────

const ScheduleInput = z.object({
  timezone: z.string().trim().min(1),
  crawlCron: z.string().trim().min(1),
  runCron: z.string().trim().min(1),
  digestCron: z.string().trim().min(1),
  discoveryCron: z.string().trim().min(1),
});

/** Validate every cron string with croner before saving; the worker picks changes up within five minutes. */
export async function saveSchedule(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const p = ScheduleInput.safeParse(Object.fromEntries(formData));
  if (!p.success) return { ok: false, message: "Every field is required" };
  const tzError = validateTimezone(p.data.timezone);
  if (tzError) return { ok: false, message: tzError };
  for (const [name, pattern] of [["crawl", p.data.crawlCron], ["run", p.data.runCron], ["digest", p.data.digestCron], ["discovery", p.data.discoveryCron]] as const) {
    const err = validateCron(pattern, p.data.timezone);
    if (err) return { ok: false, message: `${name} schedule "${pattern}": ${err}` };
  }
  const db = getDb();
  setSetting(db, "schedule.timezone", p.data.timezone);
  setSetting(db, "schedule.crawlCron", p.data.crawlCron);
  setSetting(db, "schedule.runCron", p.data.runCron);
  setSetting(db, "schedule.digestCron", p.data.digestCron);
  setSetting(db, "schedule.discoveryCron", p.data.discoveryCron);
  revalidatePath("/settings");
  revalidatePath("/ops");
  return { ok: true, message: "Saved; the worker reschedules within 5 minutes" };
}

// ── Digest settings (phase 7) ────────────────────────────────────────────────

const DigestSettingsInput = z.object({
  to: z.string().default(""),
  from: z.string().trim().default(""),
  baseUrl: z.string().trim().default(""),
  slackWebhookUrl: z.string().trim().default(""),
  opsEmail: z.string().trim().default(""),
  budgetUsd: z.coerce.number().min(0).default(0),
});

export async function saveDigestSettings(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const p = DigestSettingsInput.safeParse(Object.fromEntries(formData));
  if (!p.success) return { ok: false, message: "Invalid input" };
  const to = splitLines(p.data.to.replace(/,/g, "\n")).map((a) => a.toLowerCase());
  if (to.some((a) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a))) return { ok: false, message: "Recipients must be email addresses, one per line" };
  if (p.data.opsEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.data.opsEmail)) return { ok: false, message: "Ops email must be an email address" };
  if (p.data.baseUrl && !/^https?:\/\//.test(p.data.baseUrl)) return { ok: false, message: "Base URL must start with http:// or https://" };
  if (p.data.slackWebhookUrl && !/^https:\/\/hooks\.slack\.com\//.test(p.data.slackWebhookUrl)) return { ok: false, message: "Slack webhook URLs start with https://hooks.slack.com/" };
  const db = getDb();
  setSetting(db, "digest.to", to);
  setSetting(db, "digest.from", p.data.from || SETTING_DEFAULTS["digest.from"]);
  if (p.data.baseUrl) setSetting(db, "app.baseUrl", p.data.baseUrl.replace(/\/+$/, ""));
  setSetting(db, "slack.webhookUrl", p.data.slackWebhookUrl);
  setSetting(db, "ops.email", p.data.opsEmail.toLowerCase());
  setSetting(db, "budget.monthlyUsd", p.data.budgetUsd);
  revalidatePath("/settings");
  return { ok: true, message: `Saved; ${to.length} recipient${to.length === 1 ? "" : "s"}` };
}

// ── Discovery settings (phase 8) ─────────────────────────────────────────────

const DiscoveryInput = z.object({
  enabled: z.string().optional(),
  maxNewPagesPerRun: z.coerce.number().int().min(0).max(200).default(10),
  lookbackDays: z.coerce.number().int().min(1).max(365).default(14),
  blockedDomains: z.string().default(""),
});

export async function saveDiscoverySettings(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const p = DiscoveryInput.safeParse(Object.fromEntries(formData));
  if (!p.success) return { ok: false, message: "Invalid input" };
  const db = getDb();
  setSetting(db, "discovery.enabled", p.data.enabled === "on");
  setSetting(db, "discovery.maxNewPagesPerRun", p.data.maxNewPagesPerRun);
  setSetting(db, "discovery.lookbackDays", p.data.lookbackDays);
  setSetting(db, "discovery.blockedDomains", splitLines(p.data.blockedDomains.replace(/,/g, "\n")).map((d) => d.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")));
  revalidatePath("/settings");
  return { ok: true, message: "Saved" };
}
