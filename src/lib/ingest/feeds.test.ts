import { describe, expect, it } from "vitest";
import { fetchFeed, guessFeedKind, parseFeed } from "./feeds";

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Buffer Resources</title>
<item><title>Introducing Community</title><link>https://buffer.com/resources/introducing-community/</link><pubDate>Wed, 12 Nov 2025 10:00:00 GMT</pubDate></item>
<item><title><![CDATA[Every team feature, built for agencies]]></title><link>https://buffer.com/resources/every-team-feature/</link><pubDate>Tue, 17 Jun 2026 09:30:00 +0000</pubDate></item>
</channel></rss>`;

const RSS_SINGLE = `<rss version="2.0"><channel><item><title>Only one</title><link>https://buffer.com/resources/one/</link><pubDate>Mon, 01 Jun 2026 00:00:00 GMT</pubDate></item></channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Changelog</title>
<entry><title>API, MCP and CLI</title><link rel="self" href="https://buffer.com/changelog/api.atom"/><link rel="alternate" type="text/html" href="https://buffer.com/changelog/api"/><published>2026-05-27T12:00:00Z</published><updated>2026-05-28T00:00:00Z</updated></entry>
<entry><title>Guest access beta</title><link href="https://buffer.com/changelog/guest-access"/><updated>2026-07-01T00:00:00Z</updated></entry>
</feed>`;

const SITEMAP = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://www.socialpilot.co/blog/mcp-server</loc><lastmod>2026-04-09</lastmod></url>
<url><loc>https://www.socialpilot.co/plans</loc><lastmod>2026-10-01T08:00:00+00:00</lastmod></url>
<url><loc>https://www.socialpilot.co/</loc></url>
</urlset>`;

const INDEX = `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://www.socialpilot.co/sitemap-blog.xml</loc></sitemap><sitemap><loc>https://www.socialpilot.co/sitemap-pages.xml</loc></sitemap></sitemapindex>`;

describe("parseFeed", () => {
  it("parses RSS 2.0 items with dates", () => {
    const f = parseFeed(RSS);
    expect(f.kind).toBe("rss");
    expect(f.items).toEqual([
      { url: "https://buffer.com/resources/introducing-community/", title: "Introducing Community", publishedAt: "2025-11-12" },
      { url: "https://buffer.com/resources/every-team-feature/", title: "Every team feature, built for agencies", publishedAt: "2026-06-17" },
    ]);
  });

  it("treats a single item as a one-element list", () => {
    expect(parseFeed(RSS_SINGLE).items).toHaveLength(1);
  });

  it("parses Atom entries, preferring the alternate link and published over updated", () => {
    const f = parseFeed(ATOM);
    expect(f.kind).toBe("atom");
    expect(f.items).toEqual([
      { url: "https://buffer.com/changelog/api", title: "API, MCP and CLI", publishedAt: "2026-05-27" },
      { url: "https://buffer.com/changelog/guest-access", title: "Guest access beta", publishedAt: "2026-07-01" },
    ]);
  });

  it("parses sitemaps and sitemap indexes", () => {
    const s = parseFeed(SITEMAP);
    expect(s.kind).toBe("sitemap");
    expect(s.items.map((i) => [i.url, i.publishedAt])).toEqual([
      ["https://www.socialpilot.co/blog/mcp-server", "2026-04-09"],
      ["https://www.socialpilot.co/plans", "2026-10-01"],
      ["https://www.socialpilot.co/", null],
    ]);
    const i = parseFeed(INDEX);
    expect(i.kind).toBe("sitemap_index");
    expect(i.children).toEqual(["https://www.socialpilot.co/sitemap-blog.xml", "https://www.socialpilot.co/sitemap-pages.xml"]);
  });

  it("rejects non-feed documents", () => {
    expect(() => parseFeed("<html><body>nope</body></html>")).toThrow(/Not an RSS/);
  });

  it("guesses a kind from the URL", () => {
    expect(guessFeedKind("https://x.com/sitemap_index.xml")).toBe("sitemap_index");
    expect(guessFeedKind("https://x.com/sitemap.xml")).toBe("sitemap");
    expect(guessFeedKind("https://x.com/atom.xml")).toBe("atom");
    expect(guessFeedKind("https://x.com/feed")).toBe("rss");
  });
});

describe("fetchFeed", () => {
  it("sends conditional headers and treats 304 as unchanged", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: init?.headers as Record<string, string> });
      return new Response(null, { status: 304 });
    }) as unknown as typeof fetch;
    const res = await fetchFeed({ url: "https://buffer.com/resources/feed", etag: '"abc"', lastModified: "Tue, 17 Jun 2026 09:30:00 GMT" }, { fetchImpl });
    expect(res).toEqual({ status: "unchanged" });
    expect(calls[0].headers["if-none-match"]).toBe('"abc"');
    expect(calls[0].headers["if-modified-since"]).toBe("Tue, 17 Jun 2026 09:30:00 GMT");
    expect(calls[0].headers["user-agent"]).toContain("DeltaResearchBot");
  });

  it("returns the body and validators on 200 and fails on non-feed bodies", async () => {
    const ok = (async () => new Response(RSS, { status: 200, headers: { etag: '"v2"', "last-modified": "Wed, 12 Nov 2025 10:00:00 GMT" } })) as unknown as typeof fetch;
    const res = await fetchFeed({ url: "https://buffer.com/resources/feed", etag: null, lastModified: null }, { fetchImpl: ok });
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.etag).toBe('"v2"');
      expect(res.lastModified).toBe("Wed, 12 Nov 2025 10:00:00 GMT");
      expect(res.xml).toContain("<rss");
    }
    const html = (async () => new Response("<html>not a feed</html>", { status: 200 })) as unknown as typeof fetch;
    await expect(fetchFeed({ url: "https://buffer.com/feed", etag: null, lastModified: null }, { fetchImpl: html })).rejects.toThrow(/not an RSS/);
  });
});
