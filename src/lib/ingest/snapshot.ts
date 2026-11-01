import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { Provider, Snapshot, SourceType } from "@/db/schema";
import { extractReadable } from "./extract";
import { fetchPage, FetchError, type FetchPageOptions } from "./fetchPage";

export { FetchError };

export type SnapshotRecord = {
  url: string;
  sourceType: SourceType;
  provider: Provider;
  title: string;
  publishedAt: string;
  fetchedAt: string;
  archiveUrl: string | null;
  rawHtml: string;
  extractedText: string;
  contentHash: string;
};

export function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Persist a snapshot record. Upserts the source row; skips the insert when a
 * snapshot with the same source and content hash already exists. Seeded and
 * live snapshots both go through here so the rows are identical in shape.
 */
export function insertSnapshotRecord(db: Db, competitorId: number, rec: SnapshotRecord): { snapshot: Snapshot; created: boolean } {
  let source = db
    .select()
    .from(schema.sources)
    .where(and(eq(schema.sources.competitorId, competitorId), eq(schema.sources.url, rec.url)))
    .get();
  if (!source) {
    source = db
      .insert(schema.sources)
      .values({ competitorId, url: rec.url, sourceType: rec.sourceType, provider: rec.provider, title: rec.title })
      .returning()
      .get();
  } else if (!source.title && rec.title) {
    db.update(schema.sources).set({ title: rec.title }).where(eq(schema.sources.id, source.id)).run();
  }

  const existing = db
    .select()
    .from(schema.snapshots)
    .where(and(eq(schema.snapshots.sourceId, source.id), eq(schema.snapshots.contentHash, rec.contentHash)))
    .get();
  if (existing) return { snapshot: existing, created: false };

  const snapshot = db
    .insert(schema.snapshots)
    .values({
      sourceId: source.id,
      competitorId,
      url: rec.url,
      sourceType: rec.sourceType,
      title: rec.title,
      publishedAt: rec.publishedAt,
      fetchedAt: rec.fetchedAt,
      rawHtml: rec.rawHtml,
      extractedText: rec.extractedText,
      contentHash: rec.contentHash,
      archiveUrl: rec.archiveUrl,
    })
    .returning()
    .get();
  return { snapshot, created: true };
}

export type CreateSnapshotArgs = {
  competitorId: number;
  url: string;
  sourceType: SourceType;
  provider: Provider;
  publishedAt?: string;
  archiveTimestamp?: string;
  title?: string;
  fetchOptions?: Omit<FetchPageOptions, "archiveTimestamp">;
};

/** Build a snapshot record from the network without touching the database. */
export async function buildSnapshotRecord(args: Omit<CreateSnapshotArgs, "competitorId">): Promise<SnapshotRecord> {
  const page = await fetchPage(args.url, { ...args.fetchOptions, archiveTimestamp: args.archiveTimestamp });
  const extracted = extractReadable(page.html, args.url);
  if (extracted.text.length < 200) {
    throw new FetchError(`Could not extract readable text from ${args.url} (got ${extracted.text.length} chars)`, args.url);
  }
  // publishedAt precedence: explicit argument → extracted from the page → fetch time.
  const publishedAt = args.publishedAt ?? extracted.publishedAt ?? page.fetchedAt.slice(0, 10);
  return {
    url: args.url,
    sourceType: args.sourceType,
    provider: args.provider,
    title: args.title ?? extracted.title,
    publishedAt,
    fetchedAt: page.fetchedAt,
    archiveUrl: page.archiveUrl,
    rawHtml: page.html,
    extractedText: extracted.text,
    contentHash: hashContent(extracted.text),
  };
}

/** Fetch, extract and store a page as a snapshot. Live and seeded pages use the same path. */
export async function createSnapshot(db: Db, args: CreateSnapshotArgs): Promise<{ snapshot: Snapshot; created: boolean }> {
  const rec = await buildSnapshotRecord(args);
  return insertSnapshotRecord(db, args.competitorId, rec);
}
