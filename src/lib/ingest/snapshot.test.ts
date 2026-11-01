import { describe, expect, it } from "vitest";
import { createDb, schema } from "@/db";
import { createSnapshot, FetchError, hashContent, insertSnapshotRecord } from "./snapshot";

const page = (body: string, date?: string) =>
  `<html><head><title>Pricing</title>${date ? `<meta property="article:published_time" content="${date}">` : ""}</head><body><main>${body.repeat(30)}</main></body></html>`;

function fakeFetch(html: string, status = 200): typeof fetch {
  return (async () =>
    new Response(html, { status, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
}

function setup() {
  const db = createDb(":memory:");
  const comp = db.insert(schema.competitors).values({ name: "Buffer", slug: "buffer" }).returning().get();
  return { db, comp };
}

describe("createSnapshot", () => {
  it("stores a live page with the same shape as seeded records", async () => {
    const { db, comp } = setup();
    const { snapshot, created } = await createSnapshot(db, {
      competitorId: comp.id,
      url: "https://buffer.com/pricing",
      sourceType: "pricing",
      provider: "manual_url",
      fetchOptions: { fetchImpl: fakeFetch(page("Agency plan $120 per month. ", "2023-06-17")) },
    });
    expect(created).toBe(true);
    expect(snapshot.extractedText).toContain("Agency plan $120 per month");
    expect(snapshot.publishedAt).toBe("2023-06-17");
    expect(snapshot.contentHash).toBe(hashContent(snapshot.extractedText));
    expect(snapshot.archiveUrl).toBeNull();
    const src = db.select().from(schema.sources).get();
    expect(src?.provider).toBe("manual_url");
  });

  it("dedupes by content hash and keeps one source per url", async () => {
    const { db, comp } = setup();
    const opts = {
      competitorId: comp.id,
      url: "https://buffer.com/pricing",
      sourceType: "pricing" as const,
      provider: "seeded" as const,
      fetchOptions: { fetchImpl: fakeFetch(page("Agency plan $120 per month. ")) },
    };
    const a = await createSnapshot(db, opts);
    const b = await createSnapshot(db, opts);
    expect(b.created).toBe(false);
    expect(b.snapshot.id).toBe(a.snapshot.id);
    const c = await createSnapshot(db, { ...opts, fetchOptions: { fetchImpl: fakeFetch(page("Agency plan $100 per month. ")) } });
    expect(c.created).toBe(true);
    expect(db.select().from(schema.sources).all()).toHaveLength(1);
    expect(db.select().from(schema.snapshots).all()).toHaveLength(2);
  });

  it("publishedAt precedence: explicit > extracted > fetchedAt", async () => {
    const { db, comp } = setup();
    const explicit = await createSnapshot(db, {
      competitorId: comp.id,
      url: "https://buffer.com/a",
      sourceType: "blog",
      provider: "seeded",
      publishedAt: "2020-01-01",
      fetchOptions: { fetchImpl: fakeFetch(page("Some article text about agencies. ", "2023-06-17")) },
    });
    expect(explicit.snapshot.publishedAt).toBe("2020-01-01");
    const fallback = await createSnapshot(db, {
      competitorId: comp.id,
      url: "https://buffer.com/b",
      sourceType: "blog",
      provider: "seeded",
      fetchOptions: { fetchImpl: fakeFetch(page("Some article text about agencies. ")) },
    });
    expect(fallback.snapshot.publishedAt).toBe(fallback.snapshot.fetchedAt.slice(0, 10));
  });

  it("throws a readable FetchError on HTTP errors and JS-only pages", async () => {
    const { db, comp } = setup();
    const base = { competitorId: comp.id, url: "https://buffer.com/x", sourceType: "blog" as const, provider: "manual_url" as const };
    await expect(createSnapshot(db, { ...base, fetchOptions: { fetchImpl: fakeFetch("nope", 404) } })).rejects.toThrow(/HTTP 404/);
    await expect(createSnapshot(db, { ...base, fetchOptions: { fetchImpl: fakeFetch("<html></html>") } })).rejects.toThrow(/JavaScript/);
    await expect(createSnapshot(db, { ...base, fetchOptions: { fetchImpl: fakeFetch("<html></html>") } })).rejects.toBeInstanceOf(FetchError);
    expect(db.select().from(schema.snapshots).all()).toHaveLength(0);
  });

  it("insertSnapshotRecord is idempotent for seeded records", () => {
    const { db, comp } = setup();
    const rec = {
      url: "https://buffer.com/pricing",
      sourceType: "pricing" as const,
      provider: "seeded" as const,
      title: "Pricing",
      publishedAt: "2023-06-17",
      fetchedAt: "2026-10-31T00:00:00.000Z",
      archiveUrl: "https://web.archive.org/web/20230617041020id_/https://buffer.com/pricing",
      rawHtml: "<html>",
      extractedText: "Agency $120",
      contentHash: hashContent("Agency $120"),
    };
    expect(insertSnapshotRecord(db, comp.id, rec).created).toBe(true);
    expect(insertSnapshotRecord(db, comp.id, rec).created).toBe(false);
  });
});
