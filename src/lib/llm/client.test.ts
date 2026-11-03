import { describe, expect, it } from "vitest";
import { z } from "zod";
import { callJson, LlmError, type LlmClient, type LlmRequest } from "./client";

function fakeClient(responses: string[]): LlmClient & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    calls,
    async complete(req) {
      calls.push(req);
      const content = responses[calls.length - 1] ?? responses[responses.length - 1];
      return { content, usage: { promptTokens: 10, completionTokens: 5 } };
    },
  };
}

const schema = z.object({ facts: z.array(z.object({ statement: z.string() })) });

describe("callJson", () => {
  it("parses valid JSON on the first attempt", async () => {
    const client = fakeClient(['{"facts":[{"statement":"a"}]}']);
    const res = await callJson({ task: "smoke", role: "extract", system: "s", user: "u", schema, client });
    expect(res.data.facts[0].statement).toBe("a");
    expect(res.attempts).toBe(1);
    expect(res.usage).toEqual({ promptTokens: 10, completionTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });

  it("strips code fences", async () => {
    const client = fakeClient(['```json\n{"facts":[]}\n```']);
    const res = await callJson({ task: "smoke", role: "extract", system: "s", user: "u", schema, client });
    expect(res.data.facts).toEqual([]);
  });

  it("retries once with the validation error when the first response is invalid", async () => {
    const client = fakeClient(["not json at all", '{"facts":[{"statement":"ok"}]}']);
    const res = await callJson({ task: "smoke", role: "extract", system: "s", user: "u", schema, client });
    expect(res.attempts).toBe(2);
    expect(client.calls[1].user).toContain("previous response was rejected");
    expect(client.calls[1].user).toContain("not valid JSON");
    expect(res.usage.promptTokens).toBe(20);
  });

  it("retries on schema mismatch and throws after the second failure", async () => {
    const client = fakeClient(['{"facts":"nope"}', '{"wrong":true}']);
    await expect(callJson({ task: "smoke", role: "extract", system: "s", user: "u", schema, client })).rejects.toBeInstanceOf(LlmError);
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1].user).toContain("did not match the schema");
  });

  it("doubles max_tokens when the output was truncated", async () => {
    const calls: LlmRequest[] = [];
    const client: LlmClient = {
      async complete(req) {
        calls.push(req);
        if (calls.length === 1) return { content: '{"facts":[{"statement":"a', usage: { promptTokens: 1, completionTokens: 1 }, truncated: true };
        return { content: '{"facts":[]}', usage: { promptTokens: 1, completionTokens: 1 } };
      },
    };
    const res = await callJson({ task: "smoke", role: "extract", system: "s", user: "u", schema, client, maxTokens: 1000 });
    expect(res.attempts).toBe(2);
    expect(calls[0].maxTokens).toBe(1000);
    expect(calls[1].maxTokens).toBe(2000);
    expect(calls[1].user).toContain("cut off");
  });

  it("wraps transport errors in LlmError", async () => {
    const client: LlmClient = {
      async complete() {
        throw new Error("ECONNRESET");
      },
    };
    await expect(callJson({ task: "smoke", role: "extract", system: "s", user: "u", schema, client })).rejects.toThrow(/ECONNRESET/);
  });
});
