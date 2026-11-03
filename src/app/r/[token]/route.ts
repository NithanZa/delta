import { getDb } from "@/db";
import type { ReactionKind } from "@/db/schema";
import { reactFromToken, type TokenReaction } from "@/lib/reactions";
import { esc, page, rateLimited, tooManyRequests } from "../shell";

const LABELS: Record<ReactionKind, string> = { useful: "Marked useful", wrong: "Marked wrong", acted_on: "Marked acted on" };

function confirmation(r: TokenReaction, token: string, saved: boolean): string {
  return `<h1>${esc(LABELS[r.kind])}${!r.created && !saved ? " (already recorded)" : ""}</h1>
<p><strong>${esc(r.title)}</strong></p>
${saved ? `<p>Thanks, your note was saved.</p>` : `<form method="post" action="/r/${esc(token)}"><p>Optional: what made it ${r.kind === "wrong" ? "wrong" : r.kind === "acted_on" ? "worth acting on, and what did you do" : "useful"}?</p><textarea name="note" rows="3" maxlength="2000"></textarea><button type="submit">Save note</button></form>`}
<p><a href="/c/${esc(r.slug)}?tab=insights&via=digest#i-${r.insightId}">Open this insight in Delta</a></p>`;
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  if (rateLimited(request)) return tooManyRequests();
  const { token } = await params;
  const r = reactFromToken(getDb(), token);
  if ("error" in r) return page(`<h1>Link not valid</h1><p>${esc(r.error)}</p>`, 400);
  return page(confirmation(r, token, false));
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  if (rateLimited(request)) return tooManyRequests();
  const { token } = await params;
  const form = await request.formData().catch(() => null);
  const note = String(form?.get("note") ?? "")
    .trim()
    .slice(0, 2000);
  const r = reactFromToken(getDb(), token, note);
  if ("error" in r) return page(`<h1>Link not valid</h1><p>${esc(r.error)}</p>`, 400);
  return page(confirmation(r, token, true));
}
