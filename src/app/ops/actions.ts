"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { getDb } from "@/db";
import { JOB_KINDS } from "@/db/schema";
import { enqueue } from "@/lib/jobs/queue";
import { sendDigest } from "@/lib/digest/job";
import { ResendSender } from "@/lib/digest/send";
import { recordEvent } from "@/lib/events";

export type OpsState = { ok: boolean; message: string; jobId?: number };

/** The basic-auth user Caddy let through, or "operator" when running without the proxy. */
async function requestActor(): Promise<string> {
  const auth = (await headers()).get("authorization") ?? "";
  if (!auth.startsWith("Basic ")) return "operator";
  return Buffer.from(auth.slice(6), "base64").toString("utf8").split(":")[0] || "operator";
}

const EnqueueInput = z.object({ kind: z.enum(JOB_KINDS), competitorId: z.coerce.number().int().optional() });

/** "Crawl now" / "Run now" / "Backup now": queue a job for the worker. */
export async function enqueueJob(_prev: OpsState, formData: FormData): Promise<OpsState> {
  const raw = Object.fromEntries(formData);
  if (raw.competitorId === "") delete raw.competitorId;
  const p = EnqueueInput.safeParse(raw);
  if (!p.success) return { ok: false, message: "Invalid input" };
  const job = enqueue(getDb(), { kind: p.data.kind, competitorId: p.data.competitorId ?? null, requestedBy: "ui" });
  revalidatePath("/ops");
  return { ok: true, message: `Queued job #${job.id}; the worker picks it up within 20 s`, jobId: job.id };
}

/** Send a held or failed digest despite its pre-send findings; the override is recorded as an event. */
export async function sendAnyway(_prev: OpsState, formData: FormData): Promise<OpsState> {
  const digestId = Number(formData.get("digestId"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!Number.isInteger(digestId)) return { ok: false, message: "Invalid digest" };
  if (reason.length < 5) return { ok: false, message: "Say why it is safe to send (at least 5 characters)" };
  const db = getDb();
  try {
    const actor = await requestActor();
    const r = await sendDigest(db, digestId, { sender: new ResendSender(), override: `${actor}: ${reason}` });
    revalidatePath("/ops");
    revalidatePath("/digests");
    return r.status === "sent" ? { ok: true, message: `Sent digest #${digestId}` } : { ok: false, message: r.reasons.join("; ") };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

const DecisionInput = z.object({
  insightId: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().positive().optional()),
  date: z.string().trim().default(""),
  text: z.string().trim().min(5, "Say what changed (at least 5 characters)").max(2000),
});

/** The pilot's primary success signal, recorded by the operator once the partner confirms it. */
export async function recordDecision(_prev: OpsState, formData: FormData): Promise<OpsState> {
  const p = DecisionInput.safeParse(Object.fromEntries(formData));
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "Invalid input" };
  const db = getDb();
  recordEvent(db, "decision_influenced", { insightId: p.data.insightId ?? null, date: p.data.date || new Date().toISOString().slice(0, 10), text: p.data.text, recordedBy: await requestActor() });
  revalidatePath("/ops");
  return { ok: true, message: "Recorded" };
}
