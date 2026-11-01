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

export async function saveQuestions(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const parsed = QuestionsInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Invalid input" };
  const lines = parsed.data.questions
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const db = getDb();
  db.delete(schema.researchQuestions).where(eq(schema.researchQuestions.competitorId, parsed.data.competitorId)).run();
  if (lines.length) db.insert(schema.researchQuestions).values(lines.map((text) => ({ competitorId: parsed.data.competitorId, text }))).run();
  revalidatePath("/");
  revalidatePath("/settings");
  revalidatePath("/c/[slug]", "page");
  return { ok: true, message: `Saved ${lines.length} question${lines.length === 1 ? "" : "s"}` };
}
