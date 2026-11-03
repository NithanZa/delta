import { after } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { DECISION_QUESTION } from "@/lib/digest/job";
import { DECISION_QUESTION_EVERY } from "@/lib/digest/thresholds";
import { verifyReply } from "@/lib/links";
import { processReply, recordReply, REPLY_MAX_CHARS } from "@/lib/replies";
import { esc, page, rateLimited, tooManyRequests } from "../../shell";

const invalid = (reason: string) => page(`<h1>This link no longer works</h1><p>${reason === "expired" ? "Links in a digest last 90 days. Next week's digest will have a new one." : "Please use the link in your latest digest."}</p>`, 400);

function form(token: string, sequence: number | undefined, opts: { text?: string; author?: string; error?: string } = {}): string {
  const asksDecision = sequence !== undefined && sequence % DECISION_QUESTION_EVERY === 0;
  return `<h1>💬 Send Delta a note</h1>
${asksDecision ? `<p class="note">${esc(DECISION_QUESTION)}</p>` : ""}
<p>Tell Delta something it can't see on the web, like what a customer said about a competitor, or paste a link to a page it should read. It will use this in next week's analysis.</p>
${opts.error ? `<p class="bad">${esc(opts.error)}</p>` : ""}
<form method="post" action="/r/reply/${esc(token)}">
<label for="text">Your note or link</label>
<textarea id="text" name="text" rows="6" maxlength="${REPLY_MAX_CHARS}" required>${esc(opts.text ?? "")}</textarea>
<label for="author">Your name (optional)</label>
<input id="author" name="author" maxlength="80" value="${esc(opts.author ?? "")}">
<button type="submit">Send</button>
</form>
<p style="font-size:12px;color:#6b7280;margin-top:16px">Delta treats notes as something you told it, not as a published fact, and shows them that way.</p>`;
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  if (rateLimited(request)) return tooManyRequests();
  const { token } = await params;
  const v = verifyReply(token);
  if (!v.ok) return invalid(v.reason);
  const digest = getDb().select().from(schema.digests).where(eq(schema.digests.id, v.digestId)).get();
  return page(form(token, digest?.sequence));
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  if (rateLimited(request)) return tooManyRequests();
  const { token } = await params;
  const v = verifyReply(token);
  if (!v.ok) return invalid(v.reason);
  const db = getDb();
  const digest = db.select().from(schema.digests).where(eq(schema.digests.id, v.digestId)).get();
  const data = await request.formData().catch(() => null);
  const text = String(data?.get("text") ?? "").trim();
  const author = String(data?.get("author") ?? "");
  if (!text) return page(form(token, digest?.sequence, { author, error: "Please write a note or paste a link first." }), 400);
  const message = recordReply(db, { digestId: v.digestId, text, author });
  // Fetching a pasted link can take a while; the note is already saved, so the sender need not wait.
  after(() => processReply(db, message.id).catch(() => {}));
  return page(`<h1>✅ Thanks, Delta has your note</h1><p>It will be part of next week's analysis.</p><p><a href="/r/reply/${esc(token)}">Send another</a></p>`);
}
