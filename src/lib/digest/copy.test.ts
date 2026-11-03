import { describe, expect, it } from "vitest";
import { MockLlmClient } from "@/lib/llm/mock";
import type { CompetitorHighlights } from "./highlights";
import { EMPTY_COPY, numbersIn, writeDigestCopy } from "./copy";

const highlights = [
  {
    digest: { competitor: { name: "Buffer" } },
    hasNews: true,
    insights: [{ id: 1, title: "Buffer cut Agency to $100", whatHappened: "The plan went from $120 to $100.", whyItMatters: "Agencies compare on price.", whatToDoNext: "Compare plans.", actions: [] }],
    moves: [{ update: { id: 2 }, hypothesis: { statement: "Buffer is targeting agencies." } }],
    changes: [{ fact: { id: 3, statement: "Between 2024-06-02 and 2026-10-31 the page dropped the $100 price." } }],
    conflicts: [{ id: 4, question: "Is the price $100 or $120?" }],
  },
] as unknown as CompetitorHighlights[];

const answer = (over: object = {}) => ({
  intro: "Buffer cut its Agency plan price.",
  insights: [{ id: 1, headline: "Buffer lowered its Agency price to $100", why: "Agencies compare on price.", action: "Compare the two plans." }],
  theories: [{ id: 2, text: "Buffer seems to be going after agencies." }],
  changes: [{ id: 3, text: "The agency page no longer shows the $100 price." }],
  questions: [{ id: 4, text: "Sources give both $100 and $120." }],
  ...over,
});

const write = (out: unknown) => writeDigestCopy(highlights, "Loop", { client: new MockLlmClient().on("write_digest", () => out) });

describe("writeDigestCopy", () => {
  it("uses the rewrites and tells the model to write plainly and add nothing", async () => {
    const client = new MockLlmClient().on("write_digest", () => answer());
    const copy = await writeDigestCopy(highlights, "Loop", { client });
    expect(copy.intro).toBe("Buffer cut its Agency plan price.");
    expect(copy.insights[1].headline).toBe("Buffer lowered its Agency price to $100");
    expect(copy.moves[2]).toBe("Buffer seems to be going after agencies.");
    expect(copy.changes[3]).toBe("The agency page no longer shows the $100 price.");
    expect(copy.conflicts[4]).toBe("Sources give both $100 and $120.");
    expect(client.calls[0].system).toMatch(/everyday words/);
    expect(client.calls[0].system).toMatch(/Never add a fact/);
    expect(client.calls[0].user).toContain("Buffer cut Agency to $100");
  });

  it("keeps the original wording when a rewrite adds a figure the source does not have", async () => {
    const copy = await write(answer({ changes: [{ id: 3, text: "The agency page dropped the $90 price." }], insights: [{ id: 1, headline: "Buffer lowered Agency by 25%", why: "Agencies compare on price.", action: "Compare the two plans." }] }));
    expect(copy.changes[3]).toBeUndefined();
    expect(copy.insights[1].headline).toBeUndefined();
    expect(copy.insights[1].why).toBe("Agencies compare on price.");
  });

  it("rejects internal ids, overlong text, and ids it was not given", async () => {
    const copy = await write(answer({ theories: [{ id: 2, text: "See F12 for why." }], questions: [{ id: 4, text: "x".repeat(400) }], changes: [{ id: 99, text: "Invented item." }] }));
    expect(copy.moves[2]).toBeUndefined();
    expect(copy.conflicts[4]).toBeUndefined();
    expect(copy.changes[99]).toBeUndefined();
  });

  it("falls back completely on invalid output and skips the call when nothing is shown", async () => {
    const lines: string[] = [];
    expect(await writeDigestCopy(highlights, "Loop", { client: new MockLlmClient().on("write_digest", () => "not json"), log: (m) => lines.push(m) })).toEqual(EMPTY_COPY);
    expect(lines).toHaveLength(1);
    const client = new MockLlmClient();
    expect(await writeDigestCopy([{ ...highlights[0], hasNews: false }], "Loop", { client })).toEqual(EMPTY_COPY);
    expect(client.calls).toHaveLength(0);
  });

  it("reads figures with separators and decimals", () => {
    expect(numbersIn("From $1,200.50 to 25% in 2026.")).toEqual(["1200.50", "25", "2026"]);
  });
});
