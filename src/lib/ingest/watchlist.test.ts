import { describe, expect, it } from "vitest";
import { discoverFeedLinks, domainFromWebsite, isOnDomain, proposeWatchlist, sourceTypeForPath } from "./watchlist";

const paragraph = "SocialPilot helps marketing agencies schedule content, collaborate with clients and report results across every major network. ";
const page = (title: string, extra = "") =>
  `<html><head><title>${title}</title>${extra}</head><body><main><h1>${title}</h1>${`<p>${paragraph}</p>`.repeat(8)}</main></body></html>`;

/** A fake site: home, plans, agencies solutions, a 404 for everything else, an RSS feed and a sitemap listed in robots.txt. */
function fakeSite() {
  const seen: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);
    const html = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    const xml = (body: string) => new Response(body, { status: 200, headers: { "content-type": "application/xml" } });
    if (url === "https://www.socialpilot.co/") return html(page("SocialPilot", '<link rel="alternate" type="application/rss+xml" href="/blog/rss.xml">'));
    if (url === "https://www.socialpilot.co/plans") return html(page("Plans | SocialPilot"));
    if (url === "https://www.socialpilot.co/pricing") return Response.redirect("https://www.socialpilot.co/plans", 301);
    if (url === "https://www.socialpilot.co/solutions") return html(page("Solutions for agencies"));
    if (url === "https://www.socialpilot.co/blog/rss.xml") return xml('<rss version="2.0"><channel><item><title>x</title><link>https://www.socialpilot.co/blog/x</link></item></channel></rss>');
    if (url === "https://www.socialpilot.co/robots.txt") return new Response("User-agent: *\nDisallow: /admin\nSitemap: https://www.socialpilot.co/sitemap_index.xml\n", { status: 200 });
    if (url === "https://www.socialpilot.co/sitemap_index.xml") return xml("<sitemapindex><sitemap><loc>https://www.socialpilot.co/sitemap-blog.xml</loc></sitemap></sitemapindex>");
    if (url === "https://www.socialpilot.co/sitemap.xml") return xml("<urlset><url><loc>https://www.socialpilot.co/plans</loc></url></urlset>");
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

describe("watchlist helpers", () => {
  it("derives domains and checks membership including subdomains", () => {
    expect(domainFromWebsite("https://www.socialpilot.co/")).toBe("socialpilot.co");
    expect(domainFromWebsite("buffer.com")).toBe("buffer.com");
    expect(domainFromWebsite("")).toBe("");
    expect(isOnDomain("https://support.buffer.com/article/1", "buffer.com")).toBe(true);
    expect(isOnDomain("https://buffer.com.evil.example/x", "buffer.com")).toBe(false);
    expect(isOnDomain("https://medium.com/@buffer", "buffer.com")).toBe(false);
  });

  it("maps paths to source types", () => {
    expect(sourceTypeForPath("/pricing")).toBe("pricing");
    expect(sourceTypeForPath("/plans/")).toBe("pricing");
    expect(sourceTypeForPath("/changelog")).toBe("release_notes");
    expect(sourceTypeForPath("/resources/some-post")).toBe("blog");
    expect(sourceTypeForPath("/customers/acme")).toBe("customer_story");
    expect(sourceTypeForPath("/careers")).toBe("jobs");
    expect(sourceTypeForPath("/help/article")).toBe("docs");
    expect(sourceTypeForPath("/agency")).toBe("website");
  });

  it("discovers feed links in HTML", () => {
    const html = '<head><link rel="stylesheet" href="/a.css"><link rel="alternate" type="application/atom+xml" href="/atom.xml"><link href="https://x.com/feed" rel="alternate" type="application/rss+xml"></head>';
    expect(discoverFeedLinks(html, "https://x.com")).toEqual([
      { url: "https://x.com/atom.xml", kind: "atom" },
      { url: "https://x.com/feed", kind: "rss" },
    ]);
  });
});

describe("proposeWatchlist", () => {
  it("keeps pages that exist with real text, dedupes redirects, and finds feeds and sitemaps", async () => {
    const { fetchImpl } = fakeSite();
    const proposal = await proposeWatchlist("https://www.socialpilot.co", { fetchImpl, concurrency: 2 });
    expect(proposal.domain).toBe("socialpilot.co");
    const urls = proposal.pages.map((p) => p.url).sort();
    expect(urls).toEqual(["https://www.socialpilot.co/", "https://www.socialpilot.co/plans", "https://www.socialpilot.co/solutions"]);
    expect(proposal.pages.find((p) => p.url.endsWith("/plans"))?.sourceType).toBe("pricing");
    expect(proposal.pages.find((p) => p.url.endsWith("/solutions"))?.sourceType).toBe("website");
    const feeds = proposal.feeds.map((f) => [f.url, f.kind]);
    expect(feeds).toContainEqual(["https://www.socialpilot.co/blog/rss.xml", "rss"]);
    expect(feeds).toContainEqual(["https://www.socialpilot.co/sitemap_index.xml", "sitemap_index"]);
    expect(feeds).toContainEqual(["https://www.socialpilot.co/sitemap.xml", "sitemap"]);
  });
});
