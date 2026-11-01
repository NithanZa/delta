"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { INSIGHT_STATUSES } from "@/db/schema";

export type ActionResult = { ok: boolean; message: string };

function revalidate(slug: string) {
  revalidatePath(`/c/${slug}`);
  revalidatePath("/");
}

export async function setInsightStatus(slug: string, id: number, status: (typeof INSIGHT_STATUSES)[number]): Promise<ActionResult> {
  if (!INSIGHT_STATUSES.includes(status)) return { ok: false, message: "Invalid status" };
  getDb().update(schema.insights).set({ status }).where(eq(schema.insights.id, id)).run();
  revalidate(slug);
  return { ok: true, message: status };
}

const Correction = z.object({ slug: z.string(), id: z.coerce.number().int(), text: z.string().trim().max(2000) });

export async function correctInsight(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const p = Correction.safeParse(Object.fromEntries(formData));
  if (!p.success) return { ok: false, message: "Invalid input" };
  getDb().update(schema.insights).set({ userCorrection: p.data.text || null }).where(eq(schema.insights.id, p.data.id)).run();
  revalidate(p.data.slug);
  return { ok: true, message: p.data.text ? "Correction saved" : "Correction cleared" };
}

/**
 * Store the user's correction on a hypothesis. No update row is written here:
 * the next run's synthesis prompt receives the correction as authoritative and
 * records how it changed the hypothesis.
 */
export async function correctHypothesis(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const p = Correction.safeParse(Object.fromEntries(formData));
  if (!p.success) return { ok: false, message: "Invalid input" };
  getDb().update(schema.hypotheses).set({ userCorrection: p.data.text || null }).where(eq(schema.hypotheses.id, p.data.id)).run();
  revalidate(p.data.slug);
  return { ok: true, message: p.data.text ? "Correction saved — the next run will treat it as authoritative" : "Correction cleared" };
}

const Resolve = z.object({ slug: z.string(), id: z.coerce.number().int(), resolution: z.string().trim().max(2000) });

export async function resolveQuestion(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const p = Resolve.safeParse(Object.fromEntries(formData));
  if (!p.success) return { ok: false, message: "Invalid input" };
  getDb()
    .update(schema.openQuestions)
    .set({ status: "resolved", resolution: p.data.resolution || "Resolved by the user", resolvedRunId: null })
    .where(eq(schema.openQuestions.id, p.data.id))
    .run();
  revalidate(p.data.slug);
  return { ok: true, message: "Marked resolved" };
}
