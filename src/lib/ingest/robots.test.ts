import { describe, expect, it } from "vitest";
import { isAllowed, parseRobots, RobotsCache } from "./robots";

const ROBOTS = `# Buffer
User-agent: *
Disallow: /admin/
Disallow: /api/
Allow: /api/public
Disallow: /*.pdf$

User-agent: DeltaResearchBot
User-agent: SomeOtherBot
Disallow: /resources/private/

Sitemap: https://buffer.com/sitemap.xml
Sitemap: https://buffer.com/sitemap-blog.xml
`;

describe("robots.txt", () => {
  const rules = parseRobots(ROBOTS);

  it("collects sitemaps and groups", () => {
    expect(rules.sitemaps).toEqual(["https://buffer.com/sitemap.xml", "https://buffer.com/sitemap-blog.xml"]);
    expect(rules.groups).toHaveLength(2);
    expect(rules.groups[1].agents).toEqual(["deltaresearchbot", "someotherbot"]);
  });

  it("applies the most specific group for our agent and falls back to *", () => {
    expect(isAllowed(rules, "https://buffer.com/resources/private/x")).toBe(false);
    expect(isAllowed(rules, "https://buffer.com/admin/")).toBe(true); // our group has no /admin rule
    expect(isAllowed(rules, "https://buffer.com/admin/", "Googlebot")).toBe(false);
    expect(isAllowed(rules, "https://buffer.com/pricing", "Googlebot")).toBe(true);
  });

  it("uses longest-prefix matching with Allow winning ties, and supports * and $", () => {
    expect(isAllowed(rules, "https://buffer.com/api/public/docs", "Googlebot")).toBe(true);
    expect(isAllowed(rules, "https://buffer.com/api/private", "Googlebot")).toBe(false);
    expect(isAllowed(rules, "https://buffer.com/files/report.pdf", "Googlebot")).toBe(false);
    expect(isAllowed(rules, "https://buffer.com/files/report.pdf.html", "Googlebot")).toBe(true);
  });

  it("allows everything when robots.txt is missing or unreachable, and caches per origin", async () => {
    let calls = 0;
    const fetchImpl = (async (url: string | URL | Request) => {
      calls++;
      return String(url).startsWith("https://blocked.example") ? new Response("User-agent: *\nDisallow: /", { status: 200 }) : new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    const cache = new RobotsCache(fetchImpl);
    expect(await cache.isAllowed("https://open.example/pricing")).toBe(true);
    expect(await cache.isAllowed("https://open.example/plans")).toBe(true);
    expect(await cache.isAllowed("https://blocked.example/pricing")).toBe(false);
    expect(calls).toBe(2);
    const failing = new RobotsCache((async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch);
    expect(await failing.isAllowed("https://down.example/x")).toBe(true);
  });
});
