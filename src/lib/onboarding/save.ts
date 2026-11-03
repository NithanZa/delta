/**
 * Persist onboarding results into the existing tables (company, competitors,
 * sources, feeds, research_questions). Pure DB logic so it is testable
 * without Next's server-action context.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { Competitor, CompetitorProfile, FeedKind, OnboardingRecord, SourceType } from "@/db/schema";
import { domainFromWebsite } from "@/lib/ingest/watchlist";
import { COMPANY_FIELDS, type CompanyField } from "./draftCompany";

export type CompanyInput = {
  name: string;
  website: string;
  description: string;
  product: string;
  targetCustomers: string;
  positioning: string;
  priorities: string;
  constraints: string;
  sourceUrls: string[];
  questions: { question: string; whyItMatters: string; field: CompanyField; answer: string }[];
};

/** Upsert the single company row; answered questions are appended to their field as "Clarified: …" and kept in `onboarding`. */
export function saveCompany(db: Db, input: CompanyInput, now = new Date()) {
  const fields: Record<CompanyField, string> = {
    description: input.description.trim(),
    product: input.product.trim(),
    targetCustomers: input.targetCustomers.trim(),
    positioning: input.positioning.trim(),
    priorities: input.priorities.trim(),
    constraints: input.constraints.trim(),
  };
  for (const q of input.questions) {
    const answer = q.answer.trim();
    if (!answer) continue;
    const field = COMPANY_FIELDS.includes(q.field) ? q.field : "priorities";
    fields[field] = `${fields[field]}${fields[field] ? "\n" : ""}Clarified: ${answer}`;
  }
  const onboarding: OnboardingRecord = { draftedAt: now.toISOString(), sourceUrls: input.sourceUrls, questions: input.questions.map((q) => ({ ...q, answer: q.answer.trim() })) };
  const row = { name: input.name.trim(), website: input.website.trim(), ...fields, onboarding, updatedAt: now.toISOString() };
  const existing = db.select().from(schema.company).get();
  if (existing) return db.update(schema.company).set(row).where(eq(schema.company.id, existing.id)).returning().get();
  return db.insert(schema.company).values(row).returning().get();
}

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export type CompetitorInput = {
  name: string;
  website: string;
  description: string;
  profile: CompetitorProfile | null;
  emphasis: string;
  pages: { url: string; sourceType: SourceType; watch: boolean }[];
  feeds: { url: string; kind: FeedKind }[];
  researchQuestions: string[];
};

export type CreateCompetitorResult = { competitor: Competitor; sources: number; feeds: number; questions: number };

/** Insert a competitor with its watchlist, feeds and research questions in one transaction. Fails when the slug is taken. */
export function createCompetitor(db: Db, input: CompetitorInput, now = new Date()): CreateCompetitorResult {
  const name = input.name.trim();
  const slug = slugify(name);
  if (!slug) throw new Error("Name must contain at least one letter or digit");
  const taken = db.select({ id: schema.competitors.id, name: schema.competitors.name }).from(schema.competitors).where(eq(schema.competitors.slug, slug)).get();
  if (taken) throw new Error(`"${taken.name}" already uses the slug "${slug}". Pick a different name.`);
  return db.transaction((tx) => {
    const competitor = tx
      .insert(schema.competitors)
      .values({ name, slug, website: input.website.trim(), description: input.description.trim(), domain: domainFromWebsite(input.website), profile: input.profile, emphasis: input.emphasis.trim(), onboardedAt: now.toISOString() })
      .returning()
      .get();
    let sources = 0;
    const seen = new Set<string>();
    for (const p of input.pages) {
      if (seen.has(p.url)) continue;
      seen.add(p.url);
      tx.insert(schema.sources).values({ competitorId: competitor.id, url: p.url, sourceType: p.sourceType, provider: "watchlist", watch: p.watch }).run();
      sources++;
    }
    let feeds = 0;
    for (const f of input.feeds) {
      const exists = tx.select({ id: schema.feeds.id }).from(schema.feeds).where(and(eq(schema.feeds.competitorId, competitor.id), eq(schema.feeds.url, f.url))).get();
      if (exists) continue;
      tx.insert(schema.feeds).values({ competitorId: competitor.id, url: f.url, kind: f.kind }).run();
      feeds++;
    }
    const questions = input.researchQuestions.map((q) => q.trim()).filter(Boolean);
    if (questions.length) tx.insert(schema.researchQuestions).values(questions.map((text) => ({ competitorId: competitor.id, text }))).run();
    return { competitor, sources, feeds, questions: questions.length };
  });
}
