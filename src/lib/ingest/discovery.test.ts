import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema } from "@/db";
import { MockLlmClient } from "@/lib/llm/mock";
import { runAbsenceChecks } from "@/lib/pipeline/absence";
import { gateQuotes } from "../../../eval/lib/gates";
import { crawlCompetitor } from "./crawl";
import { discoverCompetitor, exaTextFallback, recordFromText } from "./discovery";
import { exaContents, ExaError, exaSearch } from "./exa";
import { discoveryQueries, normalizeUrl, SearchProvider } from "./providers";
import { hashContent, insertSnapshotRecord } from "./snapshot";

const paragraph = "SocialPilot, the social media management platform used by more than 13,500 agencies, was acquired by group.one today. SocialPilot will continue to operate under its own brand. ";
const html = (title: string, body: string) => `<html><head><title>${title}</title></head><body><main><h1>${title}</h1>${`<p>${body}</p>`.repeat(6)}</main></body></html>`;

type ExaCall = { url: string; body: Record<string, unknown> };

function fakeExa(results: (body: Record<string, unknown>) => unknown[], opts: { statuses?: number[]; calls?: ExaCall[] } = {}) {
  const queue = [...(opts.statuses ?? [])];
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    opts.calls?.push({ url: String(input), body });
    const status = queue.shift() ?? 200;
    if (status !== 200) return new Response(JSON.stringify({ error: "nope" }), { status });
    if (String(input).endsWith("/contents")) return new Response(JSON.stringify({ results: results(body), statuses: [] }), { status: 200 });
    return new Response(JSON.stringify({ requestId: "r", results: results(body), costDollars: { total: 0.01 } }), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("exa client", () => {
  it("sends the documented body and headers, retries 429/5xx, and fails fast on 400", async () => {
    const calls: ExaCall[] = [];
    const fetchImpl = fakeExa(() => [{ id: "1", url: "https://news.example/a", title: "A", publishedDate: "2025-07-10", text: "x" }], { statuses: [429, 500, 200], calls });
    const res = await exaSearch({ query: "SocialPilot acquisition", startPublishedDate: "2025-06-01T00:00:00.000Z", endPublishedDate: "2025-08-31T00:00:00.000Z", excludeDomains: ["socialpilot.co"], contents: { text: { maxCharacters: 20000 } } }, { fetchImpl, apiKey: "k", retryDelayMs: 0 });
    expect(res.results[0].url).toBe("https://news.example/a");
    expect(calls).toHaveLength(3);
    expect(calls[0].url).toBe("https://api.exa.ai/search");
    expect(calls[0].body).toMatchObject({ query: "SocialPilot acquisition", type: "auto", startPublishedDate: "2025-06-01T00:00:00.000Z", excludeDomains: ["socialpilot.co"], contents: { text: { maxCharacters: 20000 } } });

    const bad = fakeExa(() => [], { statuses: [400] });
    await expect(exaSearch({ query: "x" }, { fetchImpl: bad, apiKey: "k", retryDelayMs: 0 })).rejects.toBeInstanceOf(ExaError);
    await expect(exaSearch({ query: "x" }, { fetchImpl: bad, apiKey: "", retryDelayMs: 0 })).rejects.toThrow(/EXA_API_KEY/);

    const contentsCalls: ExaCall[] = [];
    await exaContents(["https://buffer.com/pricing"], { fetchImpl: fakeExa(() => [{ id: "https://buffer.com/pricing", url: "https://buffer.com/pricing", title: "Pricing", text: "t" }], { calls: contentsCalls }), apiKey: "k", maxAgeHours: 0 });
    expect(contentsCalls[0].url).toBe("https://api.exa.ai/contents");
    expect(contentsCalls[0].body).toEqual({ ids: ["https://buffer.com/pricing"], text: { maxCharacters: 60000 }, maxAgeHours: 0 });
  });
});

describe("search provider", () => {
  it("dedupes, drops blocked and known domains, keeps dates inside the window, and carries the query", async () => {
    const calls: ExaCall[] = [];
    const fetchImpl = fakeExa(
      (body) =>
        (body.includeDomains ? [{ id: "p", url: "https://www.socialpilot.co/partners/", title: "Partners", publishedDate: "2025-07-20", text: "partner program" }] : [
          { id: "1", url: "https://news.example/groupone-acquires-socialpilot?utm_source=x", title: "group.one acquires SocialPilot", publishedDate: "2025-07-10", text: paragraph, score: 0.9 },
          { id: "2", url: "https://news.example/groupone-acquires-socialpilot", title: "dup", publishedDate: "2025-07-10", text: paragraph, score: 0.8 },
          { id: "3", url: "https://x.com/socialpilot/status/1", title: "tweet", publishedDate: "2025-07-11", text: "x", score: 0.7 },
          { id: "4", url: "https://old.example/post", title: "old", publishedDate: "2024-01-01", text: "x", score: 0.6 },
          { id: "5", url: "https://known.example/page", title: "known", publishedDate: "2025-07-12", text: "x", score: 0.5 },
        ]),
      { calls },
    );
    const provider = new SearchProvider({ fetchImpl, apiKey: "k", retryDelayMs: 0, blockedDomains: ["x.com"] });
    const out = await provider.discover({ slug: "socialpilot", website: "https://www.socialpilot.co", name: "SocialPilot", domain: "socialpilot.co" }, { since: "2025-06-01", until: "2025-08-31", knownUrls: ["https://known.example/page"] });
    expect(out.map((c) => c.url)).toEqual(["https://news.example/groupone-acquires-socialpilot", "https://socialpilot.co/partners"]);
    expect(out[0]).toMatchObject({ provider: "discovery", sourceType: "press", publishedAt: "2025-07-10", score: 0.9 });
    expect(out[0].note).toContain("SocialPilot");
    expect(out[1].sourceType).toBe("website");
    expect(calls).toHaveLength(discoveryQueries("SocialPilot").length);
    const off = calls.find((c) => !c.body.includeDomains)!.body;
    expect(off).toMatchObject({ startPublishedDate: "2025-06-01T00:00:00.000Z", endPublishedDate: "2025-08-31T00:00:00.000Z", excludeDomains: ["socialpilot.co", "x.com"] });
    expect(calls.some((c) => "category" in c.body || "numResults" in c.body)).toBe(false);
    expect(provider.costUsd).toBeCloseTo(0.01 * calls.length, 6);
    expect(normalizeUrl("https://www.Buffer.com/resources/post/?utm_campaign=a&id=2#top")).toBe("https://buffer.com/resources/post?id=2");
  });
});

function setup() {
  const db = createDb(":memory:");
  db.insert(schema.company).values({ name: "Loop", priorities: "Win agencies" }).run();
  const comp = db.insert(schema.competitors).values({ name: "SocialPilot", slug: "socialpilot", website: "https://www.socialpilot.co", domain: "socialpilot.co", description: "Social media management for agencies" }).returning().get();
  db.insert(schema.researchQuestions).values({ competitorId: comp.id, text: "Who owns SocialPilot?" }).run();
  return { db, comp };
}

describe("discovery", () => {
  it("gates candidates by relevance, snapshots the relevant ones with the query and reason, falls back to search text, and honours the cap", async () => {
    const { db, comp } = setup();
    const pages: Record<string, string> = {
      "https://news.example/acquisition": html("group.one acquires SocialPilot", paragraph),
      "https://news.example/other": html("SocialPilot review", paragraph),
    };
    const fetchImpl = (async (input: string | URL | Request) => {
      const page = pages[String(input)];
      return page ? new Response(page, { status: 200, headers: { "content-type": "text/html" } }) : new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
    }) as unknown as typeof fetch;
    const candidates = [
      { url: "https://news.example/acquisition", sourceType: "press" as const, provider: "discovery" as const, publishedAt: "2025-07-10", title: "group.one acquires SocialPilot", note: "q1", text: paragraph, score: 0.9 },
      { url: "https://jsonly.example/launch", sourceType: "press" as const, provider: "discovery" as const, publishedAt: "2025-07-12", title: "SocialPilot launches MCP", note: "q2", text: paragraph.repeat(2), score: 0.8 },
      { url: "https://news.example/other", sourceType: "other" as const, provider: "discovery" as const, publishedAt: "2025-07-13", title: "SocialPilot review", note: "q3", text: paragraph, score: 0.7 },
      { url: "https://homonym.example/pilot", sourceType: "other" as const, provider: "discovery" as const, publishedAt: "2025-07-14", title: "Social pilot training", note: "q4", text: "Learn to fly with our social pilot course.", score: 0.6 },
    ];
    const r = await discoverCompetitor(db, comp.id, { since: "2025-06-01", until: "2025-08-31", candidates, fetchImpl, client: new MockLlmClient(), maxNewPages: 2, now: new Date("2025-09-01T00:00:00Z") });
    expect(r).toMatchObject({ searched: 4, relevant: 3, rejected: 1, created: 2, capped: 1, errors: 0 });
    const sources = db.select().from(schema.sources).where(eq(schema.sources.competitorId, comp.id)).all();
    expect(sources.map((s) => s.url).sort()).toEqual(["https://jsonly.example/launch", "https://news.example/acquisition"]);
    expect(sources.every((s) => s.provider === "discovery" && s.discoveryQuery && s.relevanceNote?.includes("SocialPilot"))).toBe(true);
    const snaps = db.select().from(schema.snapshots).all();
    const fallback = snaps.find((s) => s.url === "https://jsonly.example/launch")!;
    expect(fallback.rawHtml).toBe("");
    expect(fallback.extractedText).toContain("group.one");
    expect(fallback.publishedAt).toBe("2025-07-12");
    expect(snaps.find((s) => s.url === "https://news.example/acquisition")!.rawHtml).not.toBe("");
    expect(recordFromText("https://a.example", { sourceType: "press", text: " hi ", publishedAt: "2025-01-01" }).contentHash).toBe(hashContent("hi"));
  });

  it("uses Exa's crawler text for watched pages our fetcher cannot read", async () => {
    const { db, comp } = setup();
    insertSnapshotRecord(db, comp.id, { url: "https://www.socialpilot.co/plans", sourceType: "pricing", provider: "seeded", title: "Plans", publishedAt: "2025-01-08", fetchedAt: "2025-01-08T00:00:00.000Z", archiveUrl: null, rawHtml: "", extractedText: "Old plans page text. ".repeat(20), contentHash: hashContent("old") });
    db.update(schema.sources).set({ watch: true }).run();
    const tooSmall = (async () => new Response("<html><body></body></html>", { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch; // "probably rendered by JavaScript"
    const exaFetch = fakeExa(() => [{ id: "https://www.socialpilot.co/plans", url: "https://www.socialpilot.co/plans", title: "Plans | SocialPilot", text: "Ultimate plan: unlimited accounts for a flat $200 per month. ".repeat(10) }]);
    const r = await crawlCompetitor(db, comp.id, { fetchImpl: tooSmall, delayMs: 0, now: new Date("2026-11-03T00:00:00Z"), fallbackText: (url) => exaTextFallback(url, { fetchImpl: exaFetch, apiKey: "k", retryDelayMs: 0 }) });
    expect(r).toMatchObject({ checked: 1, changed: 1, errors: 0 });
    const latest = db.select().from(schema.snapshots).all().sort((a, b) => b.id - a.id)[0];
    expect(latest.rawHtml).toBe("");
    expect(latest.extractedText).toContain("$200");
    expect(db.select().from(schema.sources).get()?.lastError).toBeNull();
  });
});

describe("absence checks", () => {
  it("records found when a probed path matches, and not found with an absence fact (G1 exempt) otherwise; later found supersedes", async () => {
    const { db, comp } = setup();
    const site: Record<string, string> = { "https://socialpilot.co/affiliates": html("SocialPilot Affiliate Program", "Earn 20% recurring commission as a SocialPilot affiliate partner. Join the affiliate program today. ") };
    const fetchImpl = (async (input: string | URL | Request) => {
      const page = site[String(input)];
      return page ? new Response(page, { status: 200, headers: { "content-type": "text/html" } }) : new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;
    const now = new Date("2026-11-03T00:00:00Z");
    const r = await runAbsenceChecks(db, comp.id, { fetchImpl, now, useExa: false, topics: ["partner_program", "public_api"] });
    expect(r).toMatchObject({ checked: 2, found: 1, notFound: 1, errors: 0 });
    const checks = db.select().from(schema.absenceChecks).all();
    const found = checks.find((c) => c.topic === "partner_program")!;
    const missing = checks.find((c) => c.topic === "public_api")!;
    expect(found.result).toBe("found");
    expect(found.snapshotId).not.toBeNull();
    expect(db.select().from(schema.sources).all().find((s) => s.url === "https://socialpilot.co/affiliates")).toMatchObject({ provider: "discovery", watch: true });
    expect(missing.result).toBe("not_found");
    expect(missing.urlsChecked.length).toBeGreaterThan(0);
    const fact = db.select().from(schema.facts).where(eq(schema.facts.id, missing.factId!)).get()!;
    expect(fact).toMatchObject({ claimKind: "absence", quote: "", category: "product" });
    expect(fact.statement).toMatch(/No public API page or announcement was found on socialpilot.co/);
    const checkSnapshot = db.select().from(schema.snapshots).where(eq(schema.snapshots.id, missing.snapshotId!)).get()!;
    expect(checkSnapshot.url).toBe("check://socialpilot.co/public_api");
    expect(checkSnapshot.processedRunId).not.toBeNull();
    expect(db.select().from(schema.runs).get()?.kind).toBe("check");
    expect(gateQuotes(db).violations).toEqual([]);

    // Not due again until a month passes; forced re-check after the API page appears supersedes the absence.
    expect((await runAbsenceChecks(db, comp.id, { fetchImpl, now, useExa: false, topics: ["public_api"] })).skipped).toBe(1);
    site["https://socialpilot.co/developers"] = html("SocialPilot developer API", "Our public API lets developers schedule posts. Read the API documentation and get an API key. ");
    const later = new Date("2026-12-05T00:00:00Z");
    const r2 = await runAbsenceChecks(db, comp.id, { fetchImpl, now: later, useExa: false, topics: ["public_api"] });
    expect(r2).toMatchObject({ checked: 1, found: 1 });
    const api = db.select().from(schema.absenceChecks).all().filter((c) => c.topic === "public_api");
    expect(api.map((c) => c.result).sort()).toEqual(["found", "superseded"]);
  });
});
