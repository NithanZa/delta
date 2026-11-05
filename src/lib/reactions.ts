/**
 * Useful / Wrong / Acted-on reactions from signed digest links or the
 * dashboard. Exactly one row per (insight, digest, kind); a repeated
 * click only updates the note.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { Insight, Reaction, ReactionKind, ReviewOutcome } from "@/db/schema";
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
    // New context from the reader after a review puts the reaction back in the queue.
    const reopen = existing.reviewedAt && args.note && args.note !== existing.note ? { reviewedAt: null, reviewOutcome: null, reviewNote: null } : {};
    const reaction = args.note !== undefined ? db.update(schema.reactions).set({ note: args.note, ...reopen }).where(eq(schema.reactions.id, existing.id)).returning().get() : existing;
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

export type WrongReview = {
  reaction: Reaction;
  insight: Pick<Insight, "id" | "title" | "whatHappened">;
  competitor: { name: string; slug: string };
  evidence: { factId: number; quote: string; statement: string; url: string; title: string }[];
};

/** Wrong reactions nobody has checked yet, oldest first, each with the evidence needed to check it. */
export function openWrongReactions(db: Db): WrongReview[] {
  const rows = db
    .select({ reaction: schema.reactions, insight: schema.insights, competitor: schema.competitors })
    .from(schema.reactions)
    .innerJoin(schema.insights, eq(schema.reactions.insightId, schema.insights.id))
    .innerJoin(schema.competitors, eq(schema.insights.competitorId, schema.competitors.id))
    .where(and(eq(schema.reactions.kind, "wrong"), isNull(schema.reactions.reviewedAt)))
    .orderBy(schema.reactions.id)
    .all();
  return rows.map(({ reaction, insight, competitor }) => ({
    reaction,
    insight: { id: insight.id, title: insight.title, whatHappened: insight.whatHappened },
    competitor: { name: competitor.name, slug: competitor.slug },
    evidence: insight.factIds.length
      ? db
          .select({ factId: schema.facts.id, quote: schema.facts.quote, statement: schema.facts.statement, url: schema.snapshots.url, title: schema.snapshots.title })
          .from(schema.facts)
          .innerJoin(schema.snapshots, eq(schema.facts.snapshotId, schema.snapshots.id))
          .where(inArray(schema.facts.id, insight.factIds))
          .all()
      : [],
  }));
}

/** Record what the operator found. Returns false when there is no such Wrong reaction. */
export function reviewWrongReaction(db: Db, reactionId: number, outcome: ReviewOutcome, note = "", now = new Date()): boolean {
  const res = db
    .update(schema.reactions)
    .set({ reviewedAt: now.toISOString(), reviewOutcome: outcome, reviewNote: note || null })
    .where(and(eq(schema.reactions.id, reactionId), eq(schema.reactions.kind, "wrong")))
    .run();
  return res.changes > 0;
}

export function reactionsFor(db: Db, insightIds: number[]): Reaction[] {
  if (insightIds.length === 0) return [];
  return db
    .select()
    .from(schema.reactions)
    .all()
    .filter((r) => insightIds.includes(r.insightId));
}
