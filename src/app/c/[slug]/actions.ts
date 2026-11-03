"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { INSIGHT_STATUSES, REACTION_KINDS, type ReactionKind } from "@/db/schema";
import { recordEvent } from "@/lib/events";
import { enqueue } from "@/lib/jobs/queue";
import { react } from "@/lib/reactions";

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

const WatchInput = z.object({ slug: z.string(), sourceId: z.coerce.number().int(), watch: z.enum(["0", "1"]) });

/** Toggle re-fetching of the page behind a snapshot (Evidence tab). */
export async function setSourceWatch(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const p = WatchInput.safeParse(Object.fromEntries(formData));
  if (!p.success) return { ok: false, message: "Invalid input" };
  const res = getDb()
    .update(schema.sources)
    .set({ watch: p.data.watch === "1", enabled: true })
    .where(eq(schema.sources.id, p.data.sourceId))
    .run();
  if (res.changes === 0) return { ok: false, message: "Source not found" };
  revalidate(p.data.slug);
  revalidatePath("/settings");
  return { ok: true, message: p.data.watch === "1" ? "Watching" : "Stopped watching" };
}

const Correction = z.object({ slug: z.string(), id: z.coerce.number().int(), text: z.string().trim().max(2000) });

export async function correctInsight(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const p = Correction.safeParse(Object.fromEntries(formData));
  if (!p.success) return { ok: false, message: "Invalid input" };
  getDb().update(schema.insights).set({ userCorrection: p.data.text || null }).where(eq(schema.insights.id, p.data.id)).run();
  if (p.data.text) recordEvent(getDb(), "insight_corrected", { insightId: p.data.id, target: "insight" });
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
  getDb()
    .update(schema.hypotheses)
    .set({ userCorrection: p.data.text || null, correctionAppliedRunId: null })
    .where(eq(schema.hypotheses.id, p.data.id))
    .run();
  if (p.data.text) recordEvent(getDb(), "insight_corrected", { hypothesisId: p.data.id, target: "hypothesis" });
  revalidate(p.data.slug);
  return { ok: true, message: p.data.text ? "Correction saved — the next run will treat it as authoritative" : "Correction cleared" };
}

/** "Backfill history": queue a 24-month quarterly Wayback backfill for the worker. */
export async function enqueueBackfill(slug: string, competitorId: number): Promise<ActionResult & { jobId?: number }> {
  const db = getDb();
  const active = db
    .select()
    .from(schema.jobs)
    .all()
    .find((j) => j.kind === "backfill" && j.competitorId === competitorId && (j.status === "queued" || j.status === "running"));
  if (active) return { ok: false, message: `A backfill is already ${active.status} (job #${active.id})`, jobId: active.id };
  const job = enqueue(db, { kind: "backfill", competitorId, requestedBy: "ui", payload: { months: 24, step: "quarter", withDiscovery: false } });
  revalidate(slug);
  return { ok: true, message: `Queued backfill as job #${job.id}; the worker runs it`, jobId: job.id };
}

/** Useful / Wrong / Acted on from the dashboard (no digest attached). */
export async function reactToInsight(slug: string, insightId: number, kind: ReactionKind): Promise<ActionResult> {
  if (!REACTION_KINDS.includes(kind)) return { ok: false, message: "Invalid reaction" };
  const { created } = react(getDb(), { insightId, digestId: null, kind, source: "dashboard" });
  revalidate(slug);
  return { ok: true, message: created ? `Recorded: ${kind.replace("_", " ")}` : "Already recorded" };
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
