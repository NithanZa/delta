/**
 * Signed, expiring reaction links for digests: `<base>/r/<payload>.<signature>`.
 * payload = base64url(JSON { d: digestId, i: insightId, k: kind, exp }),
 * signature = base64url(HMAC-SHA256(secret, payload)).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ReactionKind } from "@/db/schema";
import { REACTION_KINDS } from "@/db/schema";
import { env } from "@/lib/env";

export type LinkPayload = { d: number; i: number; k: ReactionKind; exp: number };

export const LINK_TTL_DAYS = 90;
export const DEV_LINK_SECRET = "dev-only-change-me";

function defaultSecret(): string {
  if (env.linkSecret === DEV_LINK_SECRET && process.env.NODE_ENV === "production") throw new Error("DELTA_LINK_SECRET is not set; refusing to sign or verify links with the development default");
  return env.linkSecret;
}

const b64url = (buf: Buffer) => buf.toString("base64url");

function sign(payload: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(payload).digest());
}

export function signReaction(data: { digestId: number; insightId: number; kind: ReactionKind }, opts: { secret?: string; now?: Date; ttlDays?: number } = {}): string {
  const secret = opts.secret ?? defaultSecret();
  const exp = Math.floor((opts.now ?? new Date()).getTime() / 1000) + (opts.ttlDays ?? LINK_TTL_DAYS) * 86_400;
  const payload = b64url(Buffer.from(JSON.stringify({ d: data.digestId, i: data.insightId, k: data.kind, exp } satisfies LinkPayload)));
  return `${payload}.${sign(payload, secret)}`;
}

export type VerifyResult = { ok: true; payload: LinkPayload } | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyReaction(token: string, opts: { secret?: string; now?: Date } = {}): VerifyResult {
  const secret = opts.secret ?? defaultSecret();
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length) return { ok: false, reason: "malformed" };
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "bad_signature" };
  let parsed: LinkPayload;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!Number.isInteger(parsed.d) || !Number.isInteger(parsed.i) || !REACTION_KINDS.includes(parsed.k) || !Number.isFinite(parsed.exp)) return { ok: false, reason: "malformed" };
  if (parsed.exp * 1000 < (opts.now ?? new Date()).getTime()) return { ok: false, reason: "expired" };
  return { ok: true, payload: parsed };
}

export function reactionUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/r/${token}`;
}

/** The digest's "send a note" link. `k: "reply"` keeps it from ever verifying as a reaction, and the reverse. */
export function signReply(digestId: number, opts: { secret?: string; now?: Date; ttlDays?: number } = {}): string {
  const secret = opts.secret ?? defaultSecret();
  const exp = Math.floor((opts.now ?? new Date()).getTime() / 1000) + (opts.ttlDays ?? LINK_TTL_DAYS) * 86_400;
  const payload = b64url(Buffer.from(JSON.stringify({ d: digestId, k: "reply", exp })));
  return `${payload}.${sign(payload, secret)}`;
}

export type VerifyReplyResult = { ok: true; digestId: number } | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyReply(token: string, opts: { secret?: string; now?: Date } = {}): VerifyReplyResult {
  const secret = opts.secret ?? defaultSecret();
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length) return { ok: false, reason: "malformed" };
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "bad_signature" };
  let parsed: { d?: unknown; k?: unknown; exp?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!Number.isInteger(parsed.d) || parsed.k !== "reply" || typeof parsed.exp !== "number") return { ok: false, reason: "malformed" };
  if (parsed.exp * 1000 < (opts.now ?? new Date()).getTime()) return { ok: false, reason: "expired" };
  return { ok: true, digestId: parsed.d as number };
}

export function replyUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/r/reply/${token}`;
}
