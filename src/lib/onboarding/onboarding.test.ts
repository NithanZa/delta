import { describe, expect, it } from "vitest";
import { createDb, schema } from "@/db";
import { assertPublicHttpUrl, isPublicHttpUrl } from "@/lib/ingest/safeUrl";
import { MockLlmClient } from "@/lib/llm/mock";
import { draftCompany } from "./draftCompany";
import { draftCompetitor } from "./draftCompetitor";
import { prioritise, readSite } from "./fetchSite";
import { createCompetitor, saveCompany, slugify } from "./save";

const para = "Loop is a social media scheduling and client-reporting tool built for small marketing agencies. Each client has its own calendar, approval flow and monthly report. ";
const page = (title: string) => `<html><head><title>${title}</title></head><body><main><h1>${title}</h1>${`<p>${para}</p>`.repeat(8)}</main></body></html>`;

function fakeSite(host: string, paths: string[]) {
  const seen: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);
    const u = new URL(url);
    if (u.pathname === "/robots.txt") return new Response("", { status: 404 });
    if (paths.includes(u.pathname)) return new Response(page(`${u.pathname === "/" ? "Home" : u.pathname.slice(1)} | ${host}`), { status: 200, headers: { "content-type": "text/html" } });
    return new Response("nope", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

describe("safe URLs", () => {
  it("accepts public http(s) hosts and rejects local, private and non-http targets", () => {
    expect(assertPublicHttpUrl("https://buffer.com/pricing").hostname).toBe("buffer.com");
    for (const bad of ["ftp://x.com", "http://localhost:3000", "http://127.0.0.1", "http://10.0.0.5", "http://192.168.1.1/x", "http://169.254.169.254/latest", "http://[::1]/", "http://metadata.google.internal", "http://user:pw@x.com", "not a url"]) {
      expect(isPublicHttpUrl(bad), bad).toBe(false);
    }
  });
});

describe("readSite", () => {
  it("reads the home page and commercial pages in priority order, capped, and reuses probe text", async () => {
    const { fetchImpl } = fakeSite("loop.example", ["/", "/pricing", "/features", "/about", "/blog", "/careers", "/customers"]);
    const site = await readSite("loop.example", { fetchImpl, maxPages: 4 });
    expect(site.domain).toBe("loop.example");
    expect(site.website).toBe("https://loop.example/");
    expect(site.pages.map((p) => new URL(p.url).pathname)).toEqual(["/", "/pricing", "/features", "/customers"]);
    expect(site.pages[1].text).toContain("Loop is a social media");
    expect(prioritise(["https://x.com/blog", "https://x.com/about", "https://x.com/plans", "https://x.com/", "https://x.com/careers"]).map((u) => new URL(u).pathname)).toEqual(["/", "/plans", "/about", "/blog", "/careers"]);
    await expect(readSite("http://localhost:3000", { fetchImpl })).rejects.toThrow(/Local hostnames/);
    const { fetchImpl: empty } = fakeSite("down.example", []);
    await expect(readSite("https://down.example", { fetchImpl: empty })).rejects.toThrow(/Could not read any page/);
  });
});

describe("drafters with the mock model", () => {
  it("draft the company with confidences and 3–5 clarifying questions, and the competitor with a watchlist, five questions and an emphasis question", async () => {
    const { fetchImpl } = fakeSite("loop.example", ["/", "/pricing", "/features"]);
    const site = await readSite("https://loop.example", { fetchImpl });
    const client = new MockLlmClient();
    const { draft } = await draftCompany(site, client);
    expect(draft.name).toBe("Loop");
    expect(draft.clarifyingQuestions.length).toBeGreaterThanOrEqual(3);
    expect(draft.clarifyingQuestions.length).toBeLessThanOrEqual(5);
    expect(draft.clarifyingQuestions.every((q) => q.whyItMatters && q.field)).toBe(true);
    expect(draft.fieldConfidence.description).toBeGreaterThan(draft.fieldConfidence.constraints);

    const { fetchImpl: bufferFetch } = fakeSite("buffer.com", ["/", "/pricing", "/agency", "/partners"]);
    const bufferSite = await readSite("https://buffer.com", { fetchImpl: bufferFetch });
    const { draft: comp } = await draftCompetitor(bufferSite, { name: "Loop", description: "", product: "", targetCustomers: "", positioning: "", priorities: "Win small agencies", constraints: "" }, client);
    expect(comp.domain).toBe("buffer.com");
    expect(comp.researchQuestions).toHaveLength(5);
    expect(comp.researchQuestions.some((q) => /small agencies/.test(q))).toBe(true);
    expect(comp.emphasisQuestion).toMatch(/\?$/);
    expect(comp.suggestedWatchlist.map((w) => new URL(w.url).pathname).sort()).toEqual(["/", "/agency", "/partners", "/pricing"]);
    expect(comp.suggestedWatchlist.find((w) => w.url.endsWith("/pricing"))?.sourceType).toBe("pricing");
    const prompt = client.calls.find((c) => c.task === "draft_competitor")!;
    expect(prompt.system).toContain("Win small agencies");
    expect(prompt.user).toContain("=== PAGES FOUND BY THE CRAWLER");
  });
});

describe("saving", () => {
  it("writes the company with clarified answers folded into fields and kept in onboarding, then a competitor with watchlist, feeds and questions", () => {
    const db = createDb(":memory:");
    const company = saveCompany(db, {
      name: "Loop",
      website: "https://loop.example/",
      description: "Scheduling for agencies",
      product: "Scheduling",
      targetCustomers: "Agencies",
      positioning: "Clients, not channels",
      priorities: "Hypothesis: win small agencies",
      constraints: "Hypothesis: small team",
      sourceUrls: ["https://loop.example/", "https://loop.example/pricing"],
      questions: [
        { question: "Team size?", whyItMatters: "capacity", field: "constraints", answer: "6 people, 2 engineers" },
        { question: "Which segment pays?", whyItMatters: "focus", field: "targetCustomers", answer: "" },
      ],
    });
    expect(company.constraints).toBe("Hypothesis: small team\nClarified: 6 people, 2 engineers");
    expect(company.targetCustomers).toBe("Agencies");
    expect(company.onboarding?.questions).toHaveLength(2);
    expect(company.onboarding?.sourceUrls).toHaveLength(2);
    // Saving again updates the single row.
    saveCompany(db, { name: "Loop", website: "https://loop.example/", description: "x", product: "", targetCustomers: "", positioning: "", priorities: "", constraints: "", sourceUrls: [], questions: [] });
    expect(db.select().from(schema.company).all()).toHaveLength(1);

    const r = createCompetitor(db, {
      name: "Buffer",
      website: "https://buffer.com",
      description: "Scheduling",
      profile: { segments: { text: "agencies", confidence: 0.6 }, pricingModel: { text: "per channel", confidence: 0.7 }, positioning: { text: "", confidence: 0.2 }, distribution: { text: "", confidence: 0.2 }, notable: { text: "", confidence: 0.2 } },
      emphasis: "partner program",
      pages: [
        { url: "https://buffer.com/pricing", sourceType: "pricing", watch: true },
        { url: "https://buffer.com/agency", sourceType: "website", watch: false },
        { url: "https://buffer.com/pricing", sourceType: "pricing", watch: true },
      ],
      feeds: [{ url: "https://buffer.com/resources/feed", kind: "rss" }],
      researchQuestions: ["Q1 about agencies?", " ", "Q2 about pricing?"],
    });
    expect(r).toMatchObject({ sources: 2, feeds: 1, questions: 2 });
    expect(r.competitor).toMatchObject({ slug: "buffer", domain: "buffer.com", emphasis: "partner program" });
    expect(r.competitor.onboardedAt).not.toBeNull();
    const sources = db.select().from(schema.sources).all();
    expect(sources.map((s) => [s.url, s.provider, s.watch])).toEqual([
      ["https://buffer.com/pricing", "watchlist", true],
      ["https://buffer.com/agency", "watchlist", false],
    ]);
    expect(db.select().from(schema.feeds).all()).toHaveLength(1);
    expect(db.select().from(schema.researchQuestions).all().map((q) => q.text)).toEqual(["Q1 about agencies?", "Q2 about pricing?"]);
    expect(() => createCompetitor(db, { name: "Buffer!", website: "https://buffer.com", description: "", profile: null, emphasis: "", pages: [], feeds: [], researchQuestions: [] })).toThrow(/already uses the slug/);
    expect(slugify("Later.com ")).toBe("later-com");
  });
});
