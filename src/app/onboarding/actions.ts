"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { FEED_KINDS, SOURCE_TYPES } from "@/db/schema";
import { UnsafeUrlError } from "@/lib/ingest/safeUrl";
import { enqueue } from "@/lib/jobs/queue";
import { COMPANY_FIELDS, draftCompany, type CompanyDraft } from "@/lib/onboarding/draftCompany";
import { draftCompetitor, type CompetitorDraft } from "@/lib/onboarding/draftCompetitor";
import { readSite } from "@/lib/onboarding/fetchSite";
import { createCompetitor, saveCompany } from "@/lib/onboarding/save";

const Website = z
  .string()
  .trim()
  .min(1, "Enter the website URL")
  .transform((v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`))
  .pipe(z.string().url("Enter a valid URL"));

const splitLines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

function readable(e: unknown): string {
  const m = (e as Error).message ?? String(e);
  if (e instanceof UnsafeUrlError) return m;
  if (/Could not read any page/.test(m)) return `${m}. You can fill the form in by hand.`;
  return `Could not draft from the site: ${m.slice(0, 200)}. Fill the form in by hand or try another URL.`;
}

const emptyCompanyDraft = (): CompanyDraft => ({
  name: "",
  description: "",
  product: "",
  targetCustomers: "",
  positioning: "",
  priorities: "",
  constraints: "",
  fieldConfidence: { description: 0, product: 0, targetCustomers: 0, positioning: 0, priorities: 0, constraints: 0 },
  clarifyingQuestions: [],
});

// ── Step 1: company ──────────────────────────────────────────────────────────

export type CompanyDraftState = { ok: boolean; message: string; website?: string; draft?: CompanyDraft; sourceUrls?: string[]; elapsedMs?: number };

export async function draftCompanyAction(_prev: CompanyDraftState, formData: FormData): Promise<CompanyDraftState> {
  const p = Website.safeParse(formData.get("website"));
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "Enter a valid URL" };
  const t0 = Date.now();
  try {
    const site = await readSite(p.data);
    const { draft } = await draftCompany(site);
    return { ok: true, message: `Drafted from ${site.pages.length} page(s) in ${Math.round((Date.now() - t0) / 1000)} s. Review, then answer the questions below.`, website: site.website, draft, sourceUrls: site.pages.map((pg) => pg.url), elapsedMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, message: readable(e), website: p.data, draft: emptyCompanyDraft(), sourceUrls: [] };
  }
}

export type SaveState = { ok: boolean; message: string; next?: string };

export async function saveCompanyAction(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const get = (k: string) => String(formData.get(k) ?? "");
  const name = get("name").trim();
  if (!name) return { ok: false, message: "Company name is required" };
  const website = get("website").trim();
  if (website && !Website.safeParse(website).success) return { ok: false, message: "Website must be a valid URL" };
  const count = Number(get("questionCount") || 0);
  const questions = [];
  for (let i = 0; i < count; i++) {
    const question = get(`q${i}_question`).trim();
    if (!question) continue;
    const field = get(`q${i}_field`);
    questions.push({ question, whyItMatters: get(`q${i}_why`), field: (COMPANY_FIELDS as readonly string[]).includes(field) ? (field as (typeof COMPANY_FIELDS)[number]) : "priorities", answer: get(`q${i}_answer`) });
  }
  let sourceUrls: string[] = [];
  try {
    sourceUrls = JSON.parse(get("sourceUrls") || "[]");
  } catch {
    sourceUrls = [];
  }
  saveCompany(getDb(), {
    name,
    website: website ? Website.parse(website) : "",
    description: get("description"),
    product: get("product"),
    targetCustomers: get("targetCustomers"),
    positioning: get("positioning"),
    priorities: get("priorities"),
    constraints: get("constraints"),
    sourceUrls,
    questions,
  });
  revalidatePath("/");
  revalidatePath("/settings");
  revalidatePath("/onboarding");
  return { ok: true, message: `Saved ${name}${questions.filter((q) => q.answer.trim()).length ? " with your answers" : ""}`, next: "/onboarding?step=2" };
}

// ── Step 2: competitors ──────────────────────────────────────────────────────

export type CompetitorDraftState = { ok: boolean; message: string; website?: string; draft?: CompetitorDraft; otherPages?: { url: string; sourceType: string; title: string }[]; elapsedMs?: number };

export async function draftCompetitorAction(_prev: CompetitorDraftState, formData: FormData): Promise<CompetitorDraftState> {
  const p = Website.safeParse(formData.get("website"));
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "Enter a valid URL" };
  const db = getDb();
  const company = db.select().from(schema.company).get();
  if (!company) return { ok: false, message: "Set up your company first (step 1)" };
  const t0 = Date.now();
  try {
    const site = await readSite(p.data);
    const { draft } = await draftCompetitor(site, company);
    const chosen = new Set(draft.suggestedWatchlist.map((w) => w.url));
    const otherPages = site.proposal.pages.filter((pg) => !chosen.has(pg.url)).map((pg) => ({ url: pg.url, sourceType: pg.sourceType, title: pg.title }));
    return { ok: true, message: `Drafted from ${site.pages.length} page(s) in ${Math.round((Date.now() - t0) / 1000)} s. Review and save.`, website: site.website, draft, otherPages, elapsedMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, message: readable(e), website: p.data, draft: { name: "", description: "", domain: "", profile: null as never, suggestedWatchlist: [], feeds: [], researchQuestions: [], emphasisQuestion: "" }, otherPages: [] };
  }
}

export async function createCompetitorAction(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const get = (k: string) => String(formData.get(k) ?? "");
  const name = get("name").trim();
  if (!name) return { ok: false, message: "Competitor name is required" };
  const website = get("website").trim();
  const w = Website.safeParse(website);
  if (!w.success) return { ok: false, message: "Website must be a valid URL" };
  let profile = null;
  try {
    profile = get("profile") ? JSON.parse(get("profile")) : null;
  } catch {
    profile = null;
  }
  const pages = formData.getAll("page").map((v) => {
    const [url, sourceType, watch] = String(v).split("|");
    return { url, sourceType: (SOURCE_TYPES as readonly string[]).includes(sourceType) ? (sourceType as (typeof SOURCE_TYPES)[number]) : ("website" as const), watch: watch !== "0" };
  });
  const feeds = formData
    .getAll("feed")
    .map((v) => {
      const [url, kind] = String(v).split("|");
      return { url, kind: (FEED_KINDS as readonly string[]).includes(kind) ? (kind as (typeof FEED_KINDS)[number]) : ("rss" as const) };
    })
    .filter((f) => /^https?:\/\//.test(f.url));
  try {
    const r = createCompetitor(getDb(), { name, website: w.data, description: get("description"), profile, emphasis: get("emphasis"), pages: pages.filter((pg) => /^https?:\/\//.test(pg.url)), feeds, researchQuestions: splitLines(get("questions")) });
    revalidatePath("/");
    revalidatePath("/settings");
    revalidatePath("/onboarding");
    return { ok: true, message: `Added ${r.competitor.name}: ${r.sources} page(s) on the watchlist, ${r.feeds} feed(s), ${r.questions} question(s)`, next: `/c/${r.competitor.slug}` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

// ── Step 3: delivery ─────────────────────────────────────────────────────────

export async function enqueueFromOnboarding(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const kind = String(formData.get("kind"));
  if (kind !== "discovery" && kind !== "backfill" && kind !== "crawl") return { ok: false, message: "Unknown job" };
  const job = enqueue(getDb(), { kind, requestedBy: "ui" });
  revalidatePath("/ops");
  return { ok: true, message: `Queued ${kind} as job #${job.id}; the worker runs it (see /ops)` };
}
