"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";

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
    const competitor = tx.insert(schema.competitors).values({ name, slug, website, description }).returning().get();
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
  db.update(schema.competitors).set({ website, description }).where(eq(schema.competitors.id, competitorId)).run();
  revalidatePath("/");
  revalidatePath("/settings");
  revalidatePath("/c/[slug]", "page");
  return { ok: true, message: "Saved" };
}
