/**
 * Useful / Wrong / Acted-on reactions from signed digest links or the
 * dashboard. Exactly one row per (insight, digest, kind); a repeated
 * click only updates the note.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { Reaction, ReactionKind } from "@/db/schema";
import { recordEvent } from "@/lib/events";
import { verifyReaction } from "@/lib/links";

export type ReactArgs = { insightId: number; digestId: number | null; kind: ReactionKind; source: "email" | "dashboard" | "reply"; note?: string; actorEmail?: string | null };

export function findReaction(db: Db, insightId: number, digestId: number | null, kind: ReactionKind): Reaction | undefined {
  return db
    .select()
    .from(schema.reactions)
    .where(and(eq(schema.reactions.insightId, insightId), digestId === null ? isNull(schema.reactions.digestId) : eq(schema.reactions.digestId, digestId), eq(schema.reactions.kind, kind)))
    .get();
}

/** Insert or update a reaction; returns whether a new row (and event) was created. */
export function react(db: Db, args: ReactArgs): { reaction: Reaction; created: boolean } {
  const existing = findReaction(db, args.insightId, args.digestId, args.kind);
  if (existing) {
    const reaction = args.note !== undefined ? db.update(schema.reactions).set({ note: args.note }).where(eq(schema.reactions.id, existing.id)).returning().get() : existing;
    return { reaction, created: false };
  }
  const reaction = db
    .insert(schema.reactions)
    .values({ insightId: args.insightId, digestId: args.digestId, kind: args.kind, source: args.source, note: args.note ?? "", actorEmail: args.actorEmail ?? null })
    .returning()
    .get();
  recordEvent(db, "insight_reacted", { insightId: args.insightId, digestId: args.digestId, kind: args.kind, source: args.source });
  return { reaction, created: true };
}

export type TokenReaction = { kind: ReactionKind; digestId: number; insightId: number; title: string; slug: string; created: boolean };

/** Verify a signed link token and record the reaction it carries. */
export function reactFromToken(db: Db, token: string, note?: string, now?: Date): TokenReaction | { error: string } {
  const v = verifyReaction(token, { now });
  if (!v.ok) return { error: v.reason === "expired" ? "This link has expired (links are valid for 90 days)." : "This link is not valid." };
  const insight = db.select().from(schema.insights).where(eq(schema.insights.id, v.payload.i)).get();
  if (!insight) return { error: "This insight no longer exists." };
  const competitor = db.select().from(schema.competitors).where(eq(schema.competitors.id, insight.competitorId)).get();
  const { created } = react(db, { insightId: v.payload.i, digestId: v.payload.d, kind: v.payload.k, source: "email", note });
  return { kind: v.payload.k, digestId: v.payload.d, insightId: v.payload.i, title: insight.title, slug: competitor?.slug ?? "", created };
}

export function reactionsFor(db: Db, insightIds: number[]): Reaction[] {
  if (insightIds.length === 0) return [];
  return db
    .select()
    .from(schema.reactions)
    .all()
    .filter((r) => insightIds.includes(r.insightId));
}
