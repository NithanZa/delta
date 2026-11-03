import { describe, expect, it } from "vitest";
import { reactionUrl, signReaction, verifyReaction, replyUrl, signReply, verifyReply } from "./links";

const secret = "test-secret";
const now = new Date("2026-11-03T10:00:00Z");

describe("signed reaction links", () => {
  it("round-trips a payload and builds a URL", () => {
    const token = signReaction({ digestId: 12, insightId: 56, kind: "useful" }, { secret, now });
    const v = verifyReaction(token, { secret, now });
    expect(v).toEqual({ ok: true, payload: { d: 12, i: 56, k: "useful", exp: Math.floor(now.getTime() / 1000) + 90 * 86_400 } });
    expect(reactionUrl("https://delta.example.com/", token)).toBe(`https://delta.example.com/r/${token}`);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("rejects tampering, wrong secrets, malformed tokens and expired links", () => {
    const token = signReaction({ digestId: 12, insightId: 56, kind: "useful" }, { secret, now });
    const [payload, sig] = token.split(".");
    const other = Buffer.from(JSON.stringify({ d: 12, i: 57, k: "useful", exp: 9999999999 })).toString("base64url");
    expect(verifyReaction(`${other}.${sig}`, { secret, now })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyReaction(token, { secret: "another", now })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyReaction(payload, { secret, now })).toEqual({ ok: false, reason: "malformed" });
    expect(verifyReaction(`${token}.extra`, { secret, now })).toEqual({ ok: false, reason: "malformed" });
    expect(verifyReaction(token, { secret, now: new Date("2027-03-01T00:00:00Z") })).toEqual({ ok: false, reason: "expired" });
    const bogus = Buffer.from(JSON.stringify({ d: "x", i: 1, k: "nope", exp: 1 })).toString("base64url");
    const bogusToken = signReaction({ digestId: 1, insightId: 1, kind: "useful" }, { secret, now }).replace(/^[^.]+/, bogus);
    expect(verifyReaction(bogusToken, { secret, now }).ok).toBe(false);
  });
});

describe("reply links", () => {
  const secret = "test-secret";
  const now = new Date("2026-11-03T00:00:00Z");

  it("round-trips the digest id, and expires", () => {
    const token = signReply(12, { secret, now });
    expect(verifyReply(token, { secret, now })).toEqual({ ok: true, digestId: 12 });
    expect(verifyReply(token, { secret, now: new Date("2027-03-01T00:00:00Z") })).toEqual({ ok: false, reason: "expired" });
    expect(replyUrl("https://delta.example.com/", token)).toBe(`https://delta.example.com/r/reply/${token}`);
  });

  it("rejects tampering, and never works as a reaction link or the reverse", () => {
    const token = signReply(12, { secret, now });
    expect(verifyReply(`${token}x`, { secret, now })).toMatchObject({ ok: false });
    expect(verifyReply(token, { secret: "other", now })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyReaction(token, { secret, now })).toEqual({ ok: false, reason: "malformed" });
    expect(verifyReply(signReaction({ digestId: 12, insightId: 3, kind: "useful" }, { secret, now }), { secret, now })).toEqual({ ok: false, reason: "malformed" });
  });
});
