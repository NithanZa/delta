/**
 * Notes and links sent from the reply page in the app (the digest links to it).
 * URLs become pages for the next run and the remaining text becomes an
 * attributed internal note.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { Competitor, InboundMessage } from "@/db/schema";
import { recordEvent } from "@/lib/events";
import { createSnapshot, hashContent, insertSnapshotRecord } from "@/lib/ingest/snapshot";
import { domainFromWebsite, isOnDomain } from "@/lib/ingest/watchlist";

const MIN_NOTE_CHARS = 20;
export const REPLY_MAX_CHARS = 5000;
/** Who a note is credited to when the sender leaves their name blank. The digest link does not identify a person. */
export const ANONYMOUS_AUTHOR = "digest reader";

const URL_RE = /https?:\/\/[^\s<>()"']+/gi;

/** Distinct http(s) URLs, with trailing punctuation removed. */
export function extractUrls(text: string): string[] {
  const out: string[] = [];
  for (const m of text.match(URL_RE) ?? []) {
    const url = m.replace(/[.,;:!?)\]]+$/, "");
    try {
      const u = new URL(url);
      if (!out.includes(u.toString())) out.push(u.toString());
    } catch {
      // not a URL after all
    }
  }
  return out;
}

/** Text with the URLs removed, for the internal note. */
export function textWithoutUrls(text: string): string {
  return text
    .replace(URL_RE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Which competitors a reply is about: hostname of a URL, a name in the text, else all. */
export function competitorsFor(competitors: Competitor[], urls: string[], text: string): { byUrl: Map<string, Competitor | undefined>; forNote: Competitor[]; defaulted: boolean } {
  const byUrl = new Map<string, Competitor | undefined>();
  for (const url of urls) byUrl.set(url, competitors.find((c) => isOnDomain(url, c.domain || domainFromWebsite(c.website))));
  const lower = text.toLowerCase();
  const named = competitors.filter((c) => lower.includes(c.name.toLowerCase()));
  const fromUrls = [...byUrl.values()].filter((c): c is Competitor => Boolean(c));
  const forNote = named.length ? named : fromUrls.length ? [...new Set(fromUrls)] : competitors;
  return { byUrl, forNote, defaulted: named.length === 0 && fromUrls.length === 0 };
}

/** Store a reply straight away, so a slow page fetch in `processReply` cannot lose it. */
export function recordReply(db: Db, reply: { digestId: number; text: string; author?: string; now?: Date }): InboundMessage {
  const author = (reply.author ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || ANONYMOUS_AUTHOR;
  return db
    .insert(schema.inboundMessages)
    .values({ providerEmailId: `reply-${randomUUID()}`, fromEmail: author, toEmail: "", receivedAt: (reply.now ?? new Date()).toISOString(), digestId: reply.digestId, text: reply.text.slice(0, REPLY_MAX_CHARS) })
    .returning()
    .get();
}

export type ProcessResult = { status: "processed" | "failed"; pages: string[]; notes: number; reason?: string };

export async function processReply(db: Db, messageId: number, opts: { fetchImpl?: typeof fetch; log?: (m: string) => void } = {}): Promise<ProcessResult> {
  const log = opts.log ?? (() => {});
  const message = db.select().from(schema.inboundMessages).where(eq(schema.inboundMessages.id, messageId)).get();
  if (!message) return { status: "failed", pages: [], notes: 0, reason: "message not found" };
  const finish = (result: ProcessResult) => {
    db.update(schema.inboundMessages).set({ status: result.status, result: result as unknown as Record<string, unknown> }).where(eq(schema.inboundMessages.id, messageId)).run();
    return result;
  };

  try {
    const text = message.text ?? "";
    const urls = extractUrls(text);
    const competitors = db.select().from(schema.competitors).all();
    const { byUrl, forNote, defaulted } = competitorsFor(competitors, urls, text);
    const receivedDate = message.receivedAt.slice(0, 10);
    const pages: string[] = [];

    for (const url of urls) {
      const competitor = byUrl.get(url) ?? (competitors.length === 1 ? competitors[0] : forNote.length === 1 ? forNote[0] : undefined);
      if (!competitor) {
        log(`skipped ${url}: could not tell which competitor it is about`);
        continue;
      }
      try {
        const { snapshot, created } = await createSnapshot(db, { competitorId: competitor.id, url, sourceType: "other", provider: "manual_url", fetchOptions: { fetchImpl: opts.fetchImpl } });
        db.update(schema.sources).set({ note: `sent by ${message.fromEmail} on ${receivedDate}` }).where(and(eq(schema.sources.competitorId, competitor.id), eq(schema.sources.url, url))).run();
        recordEvent(db, "source_added", { url, competitorId: competitor.id, via: "reply", inboundId: messageId, created });
        pages.push(url);
        log(`${created ? "added" : "already had"} ${url} for ${competitor.name} → S${snapshot.id}`);
      } catch (e) {
        log(`could not fetch ${url}: ${(e as Error).message}`);
      }
    }

    const note = textWithoutUrls(text);
    let notes = 0;
    if (note.length >= MIN_NOTE_CHARS) {
      for (const competitor of forNote) {
        const { created } = insertSnapshotRecord(db, competitor.id, {
          url: `internal://reply/${message.providerEmailId}`,
          sourceType: "internal",
          provider: "internal",
          title: `Note from ${message.fromEmail}`,
          publishedAt: receivedDate,
          fetchedAt: new Date().toISOString(),
          archiveUrl: null,
          rawHtml: "",
          extractedText: note,
          contentHash: hashContent(`${message.providerEmailId}:${note}`),
        });
        if (created) notes++;
      }
      log(`internal note (${note.length} chars) attached to ${forNote.map((c) => c.name).join(", ")}${defaulted ? " (no competitor named; attached to all)" : ""}`);
    }
    recordEvent(db, "reply_received", { inboundId: messageId, from: message.fromEmail, digestId: message.digestId, pages: pages.length, notes });
    return finish({ status: "processed", pages, notes });
  } catch (e) {
    return finish({ status: "failed", pages: [], notes: 0, reason: (e as Error).message });
  }
}
