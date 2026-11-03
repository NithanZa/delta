import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema } from "@/db";
import { funnelByWeek, recordEvent, weekOf } from "@/lib/events";
import { hashContent, insertSnapshotRecord } from "@/lib/ingest/snapshot";
import { MockLlmClient } from "@/lib/llm/mock";
import { nextRun } from "@/lib/pipeline/presets";
import { executeRun, startRun } from "@/lib/pipeline/run";
import { react, reactFromToken } from "@/lib/reactions";
import { signReaction, verifyReply } from "@/lib/links";
import { setSetting } from "@/lib/settings";
import { buildDigestContent } from "./content";
import { citedFactIds, DECISION_QUESTION, nextDigestPeriod, preSendReasons, runDigestJob, sendDigest, slimContent } from "./job";
import { renderDigest } from "./render";
import { FakeSender } from "./send";
import { postToSlack, slackMessage } from "./slack";

const page = (plan: string, price: number) =>
  `Buffer pricing. The ${plan} plan starts at $${price} per month for up to 10 channels. Any additional channels cost extra each month. The Team plan includes unlimited users and approval workflows for every channel.`;

async function setup() {
  const db = createDb(":memory:");
  db.insert(schema.company).values({ name: "Loop", priorities: "Win agencies" }).run();
  const comp = db.insert(schema.competitors).values({ name: "Buffer", slug: "buffer", website: "https://buffer.com", domain: "buffer.com" }).returning().get();
  db.insert(schema.researchQuestions).values({ competitorId: comp.id, text: "Are they investing in agencies?" }).run();
  const add = (text: string, publishedAt: string) =>
    insertSnapshotRecord(db, comp.id, { url: "https://buffer.com/pricing", sourceType: "pricing", provider: "seeded", title: `Pricing ${publishedAt}`, publishedAt, fetchedAt: "2026-10-31T00:00:00.000Z", archiveUrl: null, rawHtml: "", extractedText: text, contentHash: hashContent(text) });
  add(page("Agency", 120), "2023-06-17");
  add(page("Agency", 100), "2024-08-16");
  const client = new MockLlmClient();
  const r1 = await executeRun(db, startRun(db, { competitorId: comp.id, ...nextRun(db, comp.id) }).id, () => {}, client);
  db.update(schema.runs).set({ startedAt: "2026-11-01T09:00:00.000Z", finishedAt: "2026-11-01T10:00:00.000Z" }).where(eq(schema.runs.id, r1.id)).run();
  const r2 = await executeRun(db, startRun(db, { competitorId: comp.id, ...nextRun(db, comp.id) }).id, () => {}, client);
  db.update(schema.runs).set({ startedAt: "2026-11-08T09:00:00.000Z", finishedAt: "2026-11-08T10:00:00.000Z" }).where(eq(schema.runs.id, r2.id)).run();
  setSetting(db, "digest.to", ["pm@partner.com"]);
  setSetting(db, "digest.from", "Delta <delta@notify.example.com>");
  setSetting(db, "app.baseUrl", "https://delta.example.com");
  setSetting(db, "ops.email", "ops@example.com");
  return { db, comp, r1, r2 };
}

const now = new Date("2026-11-10T08:00:00Z");

describe("render", () => {
  it("leads with insights, says plainly how a theory moved, and shows no internal ids or scores", async () => {
    const { db } = await setup();
    const content = buildDigestContent(db, { since: "2026-11-01T10:00:00.000Z", until: "2026-11-08T10:00:00.000Z" });
    const sign = (i: number, k: string) => `https://delta.example.com/r/token-${i}-${k}`;
    const { subject, html, text } = renderDigest(content, { baseUrl: "https://delta.example.com", sign: sign as never, replyUrl: "https://delta.example.com/r/reply/tok" });
    expect(subject).toMatch(/^Delta weekly · Loop · Nov 8$/);
    expect(html).toContain("was 50% sure, now 70%");
    expect(html).toContain("More likely");
    expect(html.match(/\/r\/token-\d+-useful/g)).toHaveLength(1);
    expect(html.match(/\/r\/token-\d+-wrong/g)).toHaveLength(1);
    expect(html.match(/\/r\/token-\d+-acted_on/g)).toHaveLength(1);
    expect(html.indexOf("What to look at")).toBeLessThan(html.indexOf("What Delta now thinks"));
    expect(html.indexOf("What Delta now thinks")).toBeLessThan(html.indexOf("What changed on the web"));
    for (const body of [html, text]) {
      expect(body).not.toMatch(/\bH\d+\b/);
      expect(body).not.toMatch(/score \d/);
      expect(body).not.toMatch(/0 pages/);
    }
    expect(text).toContain("Useful: https://delta.example.com/r/token-");
    expect(text).toContain("## Buffer");
  });

  it("uses the rewritten wording and falls back to the pipeline's where there is none", async () => {
    const { db } = await setup();
    const content = buildDigestContent(db, { since: "2026-11-01T10:00:00.000Z", until: "2026-11-08T10:00:00.000Z" });
    const insight = content.competitors[0].topInsights[0];
    const { html, text } = renderDigest(content, { baseUrl: "https://delta.example.com", sign: null, copy: { intro: "Buffer changed its plans.", insights: { [insight.id]: { headline: "Plain headline" } }, moves: {}, changes: {}, conflicts: {} } });
    expect(html).toContain("Buffer changed its plans.");
    expect(html).toContain("Plain headline");
    expect(html).not.toContain(insight.title);
    expect(html).toContain("Mock: it affects our agency segment priority.");
    expect(text).toContain("Plain headline");
  });

  it("renders the quiet variant for a period without runs", async () => {
    const { db } = await setup();
    const content = buildDigestContent(db, { since: "2026-11-08T10:00:00.000Z", until: "2026-11-15T10:00:00.000Z" });
    const { subject, html, text } = renderDigest(content, { baseUrl: "https://delta.example.com", sign: null });
    expect(content.quiet).toBe(true);
    expect(subject).toContain("quiet week");
    expect(html).toContain("Nothing important changed this week");
    expect(text).toContain("Nothing important changed this week");
    expect(html).not.toContain("/r/");
  });

  it("names Delta as the sender and points to the note page, not to email replies", async () => {
    const { db } = await setup();
    const content = buildDigestContent(db, { since: "2026-11-01T10:00:00.000Z", until: "2026-11-08T10:00:00.000Z" });
    const r = renderDigest(content, { baseUrl: "https://delta.example.com", sign: null, replyUrl: "https://delta.example.com/r/reply/tok" });
    for (const body of [r.html, r.text]) {
      expect(body).toContain("Sent by Delta, a weekly competitor digest for Loop.");
      expect(body).toContain("https://delta.example.com/r/reply/tok");
      expect(body).toContain("Replies to this email aren't read");
    }
  });
});

describe("digest job", () => {
  it("sends through the sender, records items and the event, and is a no-op for the same period", async () => {
    const { db } = await setup();
    const sender = new FakeSender();
    const first = await runDigestJob(db, { now, sender });
    expect(first.status).toBe("sent");
    expect(sender.sent).toHaveLength(1);
    const mail = sender.sent[0];
    expect(mail.to).toEqual(["pm@partner.com"]);
    const link = /\/r\/reply\/([A-Za-z0-9_.-]+)/.exec(mail.text)![1];
    expect(verifyReply(link)).toEqual({ ok: true, digestId: first.digest!.id });
    expect(mail.idempotencyKey).toBe(`digest-${first.digest!.id}`);
    expect(mail.html).toContain(`/r/`);
    const digest = db.select().from(schema.digests).get()!;
    expect(digest).toMatchObject({ status: "sent", sequence: 1, providerMessageId: "fake-1" });
    expect(digest.periodStart).toBe("2026-11-01T09:00:00.000Z"); // first run date
    expect(db.select().from(schema.digestItems).all()).toHaveLength(1);
    expect(db.select().from(schema.events).all().some((e) => e.name === "digest_sent")).toBe(true);

    // The reaction links in the sent mail work and are idempotent.
    const token = /\/r\/([A-Za-z0-9_.-]+)/.exec(mail.text)![1];
    const a = reactFromToken(db, token, undefined, now);
    expect(a).toMatchObject({ created: true, kind: "useful", digestId: digest.id });
    const b = reactFromToken(db, token, "because it changed our roadmap", now);
    expect(b).toMatchObject({ created: false });
    const rows = db.select().from(schema.reactions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toBe("because it changed our roadmap");
    expect(db.select().from(schema.events).all().filter((e) => e.name === "insight_reacted")).toHaveLength(1);

    const again = await runDigestJob(db, { now, sender });
    expect(again.status).toBe("noop");
    expect(sender.sent).toHaveLength(1);
    expect(nextDigestPeriod(db, { now }).since).toBe(now.toISOString());
  });

  it("still sends when the wording step fails", async () => {
    const { db } = await setup();
    const sender = new FakeSender();
    const lines: string[] = [];
    const client = new MockLlmClient().on("write_digest", () => {
      throw new Error("model down");
    });
    const r = await runDigestJob(db, { now, sender, client, log: (m) => lines.push(m) });
    expect(r.status).toBe("sent");
    expect(lines.some((l) => /digest wording kept as written.*model down/.test(l))).toBe(true);
  });

  it("holds the digest and emails ops when a cited quote is not verbatim", async () => {
    const { db } = await setup();
    const content = buildDigestContent(db, nextDigestPeriod(db, { now }));
    const ids = citedFactIds(content);
    expect(ids.length).toBeGreaterThan(0);
    db.update(schema.facts).set({ quote: "A sentence that is not on the page at all." }).where(eq(schema.facts.id, ids[0])).run();
    expect(preSendReasons(db, content).join(" ")).toMatch(/G1 Quotes verbatim/);
    const sender = new FakeSender();
    const r = await runDigestJob(db, { now, sender });
    expect(r.status).toBe("held");
    expect(r.digest?.status).toBe("held");
    expect(r.digest?.error).toMatch(/G1/);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].to).toEqual(["ops@example.com"]);
    expect(sender.sent[0].subject).toMatch(/held/);

    // "Send anyway" overrides and records the event.
    const forced = await sendDigest(db, r.digest!.id, { sender, override: "quote fixed by hand" });
    expect(forced.status).toBe("sent");
    expect(sender.sent[1].to).toEqual(["pm@partner.com"]);
  });

  it("marks the digest failed when the transport fails, and previews without sending", async () => {
    const { db } = await setup();
    const r = await runDigestJob(db, { now, sender: new FakeSender("SMTP down") });
    expect(r.status).toBe("failed");
    expect(r.digest?.error).toBe("SMTP down");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "delta-digest-"));
    const p = await runDigestJob(db, { now, preview: true, previewDir: dir });
    expect(p.status).toBe("preview");
    expect(fs.existsSync(p.previewFile!)).toBe(true);
    expect(fs.readFileSync(p.previewFile!, "utf8")).toContain("Delta weekly");
  });

  it("does nothing without recipients", async () => {
    const { db } = await setup();
    setSetting(db, "digest.to", []);
    const sender = new FakeSender();
    expect((await runDigestJob(db, { now, sender })).status).toBe("noop");
    expect(sender.sent).toHaveLength(0);
  });
});

describe("pilot readiness", () => {
  it("asks the 30-day question on the fourth digest only, writes a labeling sheet after each send, and keeps page bodies out of the digest row", async () => {
    const { db } = await setup();
    const labelsDir = fs.mkdtempSync(path.join(os.tmpdir(), "delta-labels-"));
    const sender = new FakeSender();
    const bodies: string[] = [];
    for (let week = 0; week < 4; week++) {
      const r = await runDigestJob(db, { now: new Date(Date.UTC(2026, 10, 10 + week * 7, 8)), sender, labelsDir });
      expect(r.status).toBe("sent");
      expect(r.digest?.sequence).toBe(week + 1);
      bodies.push(sender.sent[week].text);
      expect(r.digest!.html).not.toContain("<script");
    }
    expect(bodies.slice(0, 3).some((b) => b.includes(DECISION_QUESTION))).toBe(false);
    expect(bodies[3]).toContain(DECISION_QUESTION);
    expect(sender.sent[3].html).toContain("did anything Delta surfaced change");
    // Only the first period had runs, so the first sheet has rows and later periods have none.
    expect(fs.readdirSync(labelsDir)).toEqual(["2026-11-10.csv"]);
    const sheet = fs.readFileSync(path.join(labelsDir, "2026-11-10.csv"), "utf8");
    expect(sheet.split("\n")[0]).toBe("id,kind,text,quote,source_url,published_at,confidence,label,note");

    const stored = db.select().from(schema.digests).get()!.content as ReturnType<typeof slimContent>;
    const change = stored.competitors[0].changes[0];
    expect(change.snapshot.extractedText).toBe("");
    expect(change.snapshot.rawHtml).toBe("");
    expect(change.fact.statement.length).toBeGreaterThan(0);
  });

  it("counts the funnel per week", () => {
    const db = createDb(":memory:");
    expect(weekOf("2026-11-03T10:00:00.000Z")).toBe("2026-11-02");
    expect(weekOf("2026-11-08T23:00:00.000Z")).toBe("2026-11-02");
    expect(weekOf("2026-11-09T00:00:00.000Z")).toBe("2026-11-09");
    const at = (name: "digest_sent" | "insight_reacted" | "reply_received" | "decision_influenced" | "source_added", createdAt: string) => db.insert(schema.events).values({ name, createdAt }).run();
    at("digest_sent", "2026-11-03T08:00:00.000Z");
    at("insight_reacted", "2026-11-03T09:00:00.000Z");
    at("insight_reacted", "2026-11-04T09:00:00.000Z");
    at("source_added", "2026-11-04T09:00:00.000Z");
    at("digest_sent", "2026-11-10T08:00:00.000Z");
    at("reply_received", "2026-11-11T08:00:00.000Z");
    at("decision_influenced", "2026-11-12T08:00:00.000Z");
    expect(funnelByWeek(db)).toEqual([
      { week: "2026-11-09", sent: 1, reacted: 0, replied: 1, decided: 1 },
      { week: "2026-11-02", sent: 1, reacted: 2, replied: 0, decided: 0 },
    ]);
  });
});

describe("slack", () => {
  it("builds blocks under the limit and posts only when configured", async () => {
    const { db } = await setup();
    const content = buildDigestContent(db, { since: "2026-11-01T10:00:00.000Z", until: "2026-11-08T10:00:00.000Z" });
    const msg = slackMessage(content, "https://delta.example.com");
    expect(msg.blocks[0]).toEqual({ type: "header", text: { type: "plain_text", text: "Delta weekly · Loop" } });
    expect(msg.blocks.length).toBeLessThan(50);
    expect(JSON.stringify(msg)).toContain("<https://delta.example.com/c/buffer?tab=insights&via=slack#i-");

    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(`${String(url)} ${String(init?.body).slice(0, 20)}`);
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    expect(await postToSlack("https://hooks.slack.com/services/T/B/X", content, "https://delta.example.com", fetchImpl)).toBe("ok");
    expect(calls).toHaveLength(1);

    // Through the job: posted when the setting is present, untouched when it is empty.
    const sender = new FakeSender();
    const quietNow = new Date("2026-11-10T08:00:00Z");
    await runDigestJob(db, { now: quietNow, sender, fetchImpl });
    expect(calls).toHaveLength(1);
    setSetting(db, "slack.webhookUrl", "https://hooks.slack.com/services/T/B/X");
    const second = await runDigestJob(db, { now: new Date("2026-11-17T08:00:00Z"), sender, fetchImpl });
    expect(second.status).toBe("sent");
    expect(calls).toHaveLength(2);
  });
});

describe("dashboard reactions", () => {
  it("record one row per kind without a digest and one event each", async () => {
    const { db } = await setup();
    const insight = db.select().from(schema.insights).get()!;
    expect(react(db, { insightId: insight.id, digestId: null, kind: "wrong", source: "dashboard" }).created).toBe(true);
    expect(react(db, { insightId: insight.id, digestId: null, kind: "wrong", source: "dashboard" }).created).toBe(false);
    expect(react(db, { insightId: insight.id, digestId: null, kind: "acted_on", source: "dashboard" }).created).toBe(true);
    expect(db.select().from(schema.reactions).all()).toHaveLength(2);
    recordEvent(db, "decision_influenced", { insightId: insight.id });
    expect(db.select().from(schema.events).all().map((e) => e.name).sort()).toEqual(["decision_influenced", "insight_reacted", "insight_reacted"]);
    expect(signReaction({ digestId: 1, insightId: insight.id, kind: "useful" })).toContain(".");
  });
});
