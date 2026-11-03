import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema } from "@/db";
import { crawlCompetitor, isDue } from "./crawl";

const paragraph = "Buffer pricing. The Team plan is $10 per channel per month, billed yearly, and includes unlimited team members and approval workflows. ";
const html = (title: string, body: string) => `<html><head><title>${title}</title></head><body><main><h1>${title}</h1>${`<p>${body}</p>`.repeat(6)}</main></body></html>`;
const rss = (items: { url: string; date: string }[]) =>
  `<rss version="2.0"><channel>${items.map((i) => `<item><title>${i.url}</title><link>${i.url}</link><pubDate>${i.date}</pubDate></item>`).join("")}</channel></rss>`;

type Site = { pages: Record<string, string>; feed?: string; robots?: string; etag?: string; served: string[]; feedStatus?: number };

function fakeFetch(site: Site): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    site.served.push(url);
    if (url.endsWith("/robots.txt")) return new Response(site.robots ?? "", { status: site.robots ? 200 : 404 });
    if (url.endsWith("/feed")) {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (site.etag && headers["if-none-match"] === site.etag) return new Response(null, { status: 304 });
      return new Response(site.feed ?? "", { status: site.feedStatus ?? (site.feed ? 200 : 404), headers: site.etag ? { etag: site.etag } : {} });
    }
    const page = site.pages[url];
    if (!page) return new Response("nope", { status: 404 });
    return new Response(page, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }) as unknown as typeof fetch;
}

function setup(site: Site, opts: { watch?: boolean; feed?: boolean } = {}) {
  const db = createDb(":memory:");
  db.insert(schema.company).values({ name: "Loop" }).run();
  const comp = db.insert(schema.competitors).values({ name: "Buffer", slug: "buffer", website: "https://buffer.com", domain: "buffer.com" }).returning().get();
  const source = db
    .insert(schema.sources)
    .values({ competitorId: comp.id, url: "https://buffer.com/pricing", sourceType: "pricing", provider: "seeded", watch: opts.watch ?? true })
    .returning()
    .get();
  if (opts.feed) db.insert(schema.feeds).values({ competitorId: comp.id, url: "https://buffer.com/resources/feed", kind: "rss" }).run();
  const fetchImpl = fakeFetch(site);
  const crawl = (o: Parameters<typeof crawlCompetitor>[2] = {}) => crawlCompetitor(db, comp.id, { fetchImpl, delayMs: 0, now: new Date("2026-11-03T12:00:00Z"), ...o });
  return { db, comp, source, crawl, site };
}

describe("crawlCompetitor", () => {
  it("re-fetches a due watched page: unchanged content creates no snapshot but updates last_checked_at", async () => {
    const pricing = html("Pricing | Buffer", paragraph);
    const { db, source, crawl } = setup({ pages: { "https://buffer.com/pricing": pricing }, served: [] });
    const first = await crawl();
    expect(first).toMatchObject({ checked: 1, changed: 1, newPages: 0, errors: 0 });
    const second = await crawl({ force: true });
    expect(second).toMatchObject({ checked: 1, changed: 0 });
    const row = db.select().from(schema.sources).where(eq(schema.sources.id, source.id)).get()!;
    expect(row.lastCheckedAt).toBe("2026-11-03T12:00:00.000Z");
    expect(row.lastChangedAt).toBe("2026-11-03T12:00:00.000Z");
    expect(db.select().from(schema.snapshots).all()).toHaveLength(1);
  });

  it("creates a snapshot and sets last_changed_at when the content changed, and records fetch errors", async () => {
    const site: Site = { pages: { "https://buffer.com/pricing": html("Pricing | Buffer", paragraph) }, served: [] };
    const { db, source, crawl } = setup(site);
    await crawl();
    site.pages["https://buffer.com/pricing"] = html("Pricing | Buffer", paragraph.replace("$10", "$12"));
    const r = await crawl({ force: true, now: new Date("2026-11-10T12:00:00Z") });
    expect(r).toMatchObject({ checked: 1, changed: 1 });
    expect(db.select().from(schema.snapshots).all()).toHaveLength(2);
    expect(db.select().from(schema.sources).where(eq(schema.sources.id, source.id)).get()!.lastChangedAt).toBe("2026-11-10T12:00:00.000Z");

    delete site.pages["https://buffer.com/pricing"];
    const e = await crawl({ force: true, now: new Date("2026-11-17T12:00:00Z") });
    expect(e).toMatchObject({ checked: 1, changed: 0, errors: 1 });
    expect(db.select().from(schema.sources).where(eq(schema.sources.id, source.id)).get()!.lastError).toMatch(/HTTP 404/);
  });

  it("skips pages that are not due unless forced, and pages disallowed by robots.txt", async () => {
    const { db, crawl, source } = setup({ pages: { "https://buffer.com/pricing": html("Pricing", paragraph) }, served: [], robots: "User-agent: DeltaResearchBot\nDisallow: /pricing\n" });
    expect(isDue({ lastCheckedAt: null, checkIntervalHours: 168 }, new Date())).toBe(true);
    expect(isDue({ lastCheckedAt: "2026-11-01T00:00:00.000Z", checkIntervalHours: 168 }, new Date("2026-11-03T00:00:00Z"))).toBe(false);
    expect(isDue({ lastCheckedAt: "2026-10-01T00:00:00.000Z", checkIntervalHours: 168 }, new Date("2026-11-03T00:00:00Z"))).toBe(true);

    const r = await crawl();
    expect(r.skipped.robots).toBe(1);
    expect(r.checked).toBe(0);
    expect(db.select().from(schema.snapshots).all()).toHaveLength(0);
    db.update(schema.sources).set({ lastCheckedAt: "2026-11-03T11:00:00.000Z" }).where(eq(schema.sources.id, source.id)).run();
    const again = await crawl();
    expect(again.checked).toBe(0);
  });

  it("creates pages from feed items on the competitor's domain, oldest first, capped, with provider = feed", async () => {
    const site: Site = {
      pages: {
        "https://buffer.com/resources/a": html("A", paragraph),
        "https://buffer.com/resources/b": html("B", paragraph),
        "https://buffer.com/resources/c": html("C", paragraph),
        "https://buffer.com/resources/old": html("Old", paragraph),
      },
      feed: rss([
        { url: "https://buffer.com/resources/c", date: "Tue, 20 Oct 2026 00:00:00 GMT" },
        { url: "https://buffer.com/resources/a", date: "Thu, 01 Oct 2026 00:00:00 GMT" },
        { url: "https://buffer.com/resources/b", date: "Sat, 10 Oct 2026 00:00:00 GMT" },
        { url: "https://buffer.com/resources/old", date: "Mon, 01 Jun 2026 00:00:00 GMT" },
        { url: "https://medium.com/@buffer/offsite", date: "Thu, 15 Oct 2026 00:00:00 GMT" },
      ]),
      etag: '"v1"',
      served: [],
    };
    const { db, crawl } = setup(site, { watch: false, feed: true });
    const r = await crawl({ maxNewPages: 2 });
    expect(r).toMatchObject({ newPages: 2, feedsChecked: 1, feedsUnchanged: 0 });
    expect(r.skipped.offDomain).toBe(1);
    expect(r.skipped.capped).toBe(1);
    const sources = db.select().from(schema.sources).where(eq(schema.sources.provider, "feed")).all();
    expect(sources.map((s) => s.url).sort()).toEqual(["https://buffer.com/resources/a", "https://buffer.com/resources/b"]);
    expect(sources.every((s) => s.sourceType === "blog")).toBe(true);
    const snaps = db.select().from(schema.snapshots).all();
    expect(snaps.map((s) => s.publishedAt).sort()).toEqual(["2026-10-01", "2026-10-10"]);
    const feed = db.select().from(schema.feeds).get()!;
    expect(feed.etag).toBe('"v1"');
    expect(feed.lastItemAt).toBe("2026-10-20");

    // Second crawl: the feed answers 304 → unchanged, nothing new.
    const again = await crawl({ maxNewPages: 2 });
    expect(again).toMatchObject({ newPages: 0, feedsUnchanged: 1 });
    expect(site.served.filter((u) => u.endsWith("/feed"))).toHaveLength(2);
  });

  it("records a feed error without aborting the crawl", async () => {
    const { db, crawl } = setup({ pages: {}, feedStatus: 500, feed: "boom", served: [] }, { watch: false, feed: true });
    const r = await crawl();
    expect(r.errors).toBe(1);
    expect(db.select().from(schema.feeds).get()!.lastError).toMatch(/HTTP 500/);
  });
});
