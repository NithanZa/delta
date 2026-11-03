import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema } from "@/db";
import { MockLlmClient } from "@/lib/llm/mock";
import { nextRun } from "@/lib/pipeline/presets";
import { executeRun, startRun } from "@/lib/pipeline/run";
import { competitorsFor, extractUrls, processReply, recordReply, textWithoutUrls } from "./replies";

const PAGE = `<html><head><title>Buffer Partners</title></head><body><main><h1>Buffer Agency Partner Program</h1>${"<p>Earn 25% recurring commission on new clients you bring to Buffer through your referral link. Priority partner support, playbooks and templates.</p>".repeat(6)}</main></body></html>`;

function setup() {
  const db = createDb(":memory:");
  db.insert(schema.company).values({ name: "Loop", priorities: "Win agencies" }).run();
  const buffer = db.insert(schema.competitors).values({ name: "Buffer", slug: "buffer", website: "https://buffer.com", domain: "buffer.com" }).returning().get();
  const sp = db.insert(schema.competitors).values({ name: "SocialPilot", slug: "socialpilot", website: "https://www.socialpilot.co", domain: "socialpilot.co" }).returning().get();
  db.insert(schema.researchQuestions).values({ competitorId: buffer.id, text: "Partner program?" }).run();
  const fetchImpl = (async (input: string | URL | Request) => (String(input) === "https://buffer.com/partners" ? new Response(PAGE, { status: 200, headers: { "content-type": "text/html" } }) : new Response("nope", { status: 404 }))) as unknown as typeof fetch;
  return { db, buffer, sp, fetchImpl };
}

describe("replies from the app", () => {
  it("credits the reply to the name given, or a neutral default, and keeps its digest", () => {
    const { db } = setup();
    expect(recordReply(db, { digestId: 4, text: "hello", author: "  Jane\n PM " })).toMatchObject({ fromEmail: "Jane PM", digestId: 4, status: "received", text: "hello" });
    expect(recordReply(db, { digestId: 4, text: "hello" }).fromEmail).toBe("digest reader");
  });

  it("turns a URL into a pending page and the remaining text into an attributed internal note, then the next run cites it with a capped move", async () => {
    const { db, buffer, fetchImpl } = setup();
    const message = recordReply(db, { digestId: 4, author: "Jane", text: "Our customers say Buffer's partner payouts are slow, which is why two agencies came to Loop last month.\nhttps://buffer.com/partners", now: new Date("2026-11-01T09:30:00.000Z") });
    const r = await processReply(db, message.id, { fetchImpl });
    expect(r).toMatchObject({ status: "processed", pages: ["https://buffer.com/partners"], notes: 1 });
    expect(db.select().from(schema.inboundMessages).get()?.status).toBe("processed");

    const snaps = db.select().from(schema.snapshots).where(eq(schema.snapshots.competitorId, buffer.id)).all();
    const pageSnap = snaps.find((s) => s.url === "https://buffer.com/partners")!;
    const note = snaps.find((s) => s.sourceType === "internal")!;
    expect(pageSnap.processedRunId).toBeNull();
    expect(db.select().from(schema.sources).all().find((s) => s.url === pageSnap.url)).toMatchObject({ provider: "manual_url", note: "sent by Jane on 2026-11-01" });
    expect(note).toMatchObject({ title: "Note from Jane", publishedAt: "2026-11-01" });
    expect(note.extractedText).toContain("partner payouts are slow");
    expect(note.extractedText).not.toContain("https://");
    // Only Buffer is named, so SocialPilot gets no note.
    expect(db.select().from(schema.snapshots).all().filter((s) => s.sourceType === "internal")).toHaveLength(1);
    const names = db.select().from(schema.events).all().map((e) => e.name);
    expect(names).toContain("source_added");
    expect(names).toContain("reply_received");

    // Next run: the note's facts are attributed and a hypothesis resting on them alone moves ≤ 0.1.
    const client = new MockLlmClient();
    const r1 = await executeRun(db, startRun(db, { competitorId: buffer.id, ...nextRun(db, buffer.id) }).id, () => {}, client);
    expect(r1.status).toBe("done");
    const facts = db.select().from(schema.facts).all();
    const internal = facts.filter((f) => f.attribution === "internal:Jane");
    expect(internal.length).toBeGreaterThan(0);
    expect(facts.filter((f) => f.snapshotId === pageSnap.id).every((f) => f.attribution === "public")).toBe(true);
    expect(client.calls.filter((c) => c.task === "synthesize").at(-1)!.user).toContain("[internal:Jane]");
    expect(client.calls.filter((c) => c.task === "extract_facts").some((c) => c.system.includes("Per Jane (internal):"))).toBe(true);

    const h = db.select().from(schema.hypotheses).get()!;
    client.on("synthesize", () => ({
      timelineEvents: [],
      hypothesisUpdates: [{ hypothesisId: h.id, dimension: null, statement: "", change: "strengthened", claimKind: "positive", confidence: 0.95, reasoning: "Per Jane (internal): payouts are slow.", factIds: [internal[0].id] }],
      strategyProfile: Object.fromEntries(["customers", "productDirection", "positioning", "distribution", "businessModel"].map((k) => [k, { summary: "s", confidence: 0.4, factIds: [internal[0].id] }])),
      conflicts: [],
      openQuestions: { resolved: [], new: [] },
    }));
    db.update(schema.hypotheses).set({ userCorrection: "force another run", correctionAppliedRunId: null }).where(eq(schema.hypotheses.id, h.id)).run();
    const r2 = await executeRun(db, startRun(db, { competitorId: buffer.id, ...nextRun(db, buffer.id) }).id, () => {}, client);
    expect(r2.status).toBe("done");
    const after = db.select().from(schema.hypotheses).where(eq(schema.hypotheses.id, h.id)).get()!;
    expect(after.confidence).toBeCloseTo(Math.min(0.95, h.confidence + 0.1), 5);
    expect(r2.log.some((l) => /internal only; move limited/.test(l.message))).toBe(true);
  });

  it("attaches notes to every competitor when none is named, and maps URLs by domain", () => {
    const { db, buffer, sp } = setup();
    const all = db.select().from(schema.competitors).all();
    const a = competitorsFor(all, ["https://www.socialpilot.co/plans"], "Their plans page changed.");
    expect(a.byUrl.get("https://www.socialpilot.co/plans")?.id).toBe(sp.id);
    expect(a.forNote.map((c) => c.id)).toEqual([sp.id]);
    const b = competitorsFor(all, [], "Heard something at a conference.");
    expect(b.defaulted).toBe(true);
    expect(b.forNote.map((c) => c.id).sort()).toEqual([buffer.id, sp.id].sort());
  });

  it("extracts distinct URLs without trailing punctuation", () => {
    expect(extractUrls("See https://buffer.com/partners, and https://www.socialpilot.co/plans. Also (https://buffer.com/partners) again")).toEqual(["https://buffer.com/partners", "https://www.socialpilot.co/plans"]);
    expect(textWithoutUrls("See https://buffer.com/partners\n\n\n\nand more")).toBe("See\n\nand more");
  });
});
