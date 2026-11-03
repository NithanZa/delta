# Delta prototype

## Outcome

Every Monday the partner receives an email: hypotheses with confidence moves, the top insights with one-click **Useful / Wrong / Acted on** links, what changed on which pages, open questions and conflicts, or an honest "quiet week" note that says what was checked. Replies to the email are captured: URLs become pages for the next run, free text becomes **attributed internal intelligence** that the model treats as authoritative about the partner's own company and as an unverified claim about the competitor. A web view of each digest exists, an optional Slack post mirrors it, and the five instrumentation events are recorded.

## Step-by-step

1. **Schema** (`drizzle-kit generate --name digests`):
   - `digests`: `id, sequence, period_start, period_end, status ('draft'|'held'|'sent'|'failed'), channel ('email'|'slack'), subject, html, text, content JSON, recipients JSON, sent_at, provider_message_id, error, created_at`.
   - `digest_items`: `digest_id, competitor_id, insight_id, rank`.
   - `reactions`: `id, insight_id, digest_id nullable, kind ('useful'|'wrong'|'acted_on'), note, source ('email'|'dashboard'|'reply'), actor_email nullable, created_at`; unique `(insight_id, digest_id, kind)`.
   - `events`: `id, name, props JSON, created_at` (names: `digest_sent, insight_viewed, insight_reacted, insight_corrected, source_added, reply_received, decision_influenced`).
   - `inbound_messages`: `id, provider_email_id unique, from_email, to_email, subject, text, html, received_at, digest_id nullable, status ('received'|'processed'|'ignored'|'failed'), result JSON`.
   - `SOURCE_TYPES` add `internal`. Settings keys: `digest.to` (string[]), `digest.from` (e.g. `Delta <delta@notify.example.com>`), `digest.replyDomain` (e.g. `delta.example.com`), `app.baseUrl`, `slack.webhookUrl` (optional), `ops.email`.

2. **Signed links** `src/lib/links.ts`: token = `base64url(JSON{ d: digestId, i: insightId, k: kind, exp })` + `.` + `base64url(HMAC-SHA256(DELTA_LINK_SECRET, payloadPart))`; `verify()` uses `crypto.timingSafeEqual` and rejects expired tokens (90 days). Secret from `openssl rand -base64 32`. Unit tests incl. tampering.

3. **Rendering** `src/lib/digest/render.ts`: `renderDigest(content, { baseUrl, sign })` → `{ subject, html, text }`. HTML is table-based with inline styles (max-width 640, system font stack, light background), sections per competitor: header with competitor name and "N pages checked, M changed"; "Hypotheses" lines `H3 · 0.56 → 0.70 ↑ · <statement>`; "Top insights" cards (title, Why it matters, Recommended first action, three reaction links, "Open in Delta" link to `/c/<slug>?tab=insights#i-<id>`); "What changed" (page title, dates, one-line change statement, link to the Evidence tab); "Questions and conflicts". Quiet variant: "Nothing material changed. We checked N pages across M competitors; K changed only cosmetically." Footer: "Reply to this email with a link or context and Delta will use it next week", "View this digest in the browser". Subject `Delta weekly · <company> · <Mon DD>` or `… · quiet week`. Plain-text version mirrors the structure.

4. **Reaction route** `src/app/r/[token]/route.ts`: `GET` verifies the token, inserts the reaction (ignore duplicate), `after(() => recordEvent('insight_reacted', …))`, returns a small HTML page confirming "Marked useful" with a textarea form; `POST` (same path, form body) stores the note and events. No auth, public through the proxy (phase 11). Simple in-memory rate limit (60 req/min/IP).

5. **Sending** `src/lib/digest/send.ts` with Resend (API notes): `resend.emails.send({ from, to, subject, html, text, replyTo: 'delta+d<digestId>@<replyDomain>' }, { headers: { 'Idempotency-Key': 'digest-' + id } })`. Store `provider_message_id`, set `sent`, record `digest_sent`. Errors → `failed` with the message.

6. **Digest job** (worker, `schedule.digestCron`): period = `(last sent digest.period_end ?? first run date) → now`; `buildDigestContent`; render; save as `draft`; run the zero-tolerance gates from `eval/lib/gates.ts` on the cited facts (quote fidelity, point-in-time); if any fail → `held`, email `ops.email` with the reasons, stop; else send. `--dry-run` writes `data/digests/preview-<date>.html`. CLI `scripts/digest.ts`: `npm run digest -- --preview | --send [--since YYYY-MM-DD]`.

7. **Web view** `src/app/digests/page.tsx` (list with status, sequence, period, recipients) and `src/app/digests/[id]/page.tsx` rendering the stored HTML (`dangerouslySetInnerHTML`, our own markup). `/ops` shows held digests with reasons and a "Send anyway" action.

8. **Inbound replies.** Resend receiving on a subdomain (API notes). Route `src/app/api/webhooks/resend/route.ts`: read `await request.text()`, verify with `resend.webhooks.verify`, handle `email.received`: insert `inbound_messages` (status `received`), respond 200 immediately, then `after(async () => processInbound(id))`. `src/lib/inbound/process.ts`: `resend.emails.receiving.get(email_id)` → store `text`/`html`; digest id from `to`/`received_for` plus-address `delta+d<id>@…` or subject `[Delta #<id>]`; strip quoted history (drop lines starting with `>`; cut at the first line matching `/^On .+ wrote:$/` or `-----Original Message-----`); extract `https?://` URLs; for each URL: competitor by hostname match on `competitors.domain`, else by competitor name appearing in the reply text, else the single tracked competitor; `createSnapshot(db, { url, sourceType: 'other', provider: 'manual_url' })` with `sources.note = 'sent by <from> on <date>'` and `source_added` event; remaining text ≥ 20 chars → **internal note snapshot**: `provider: 'internal'`, `sourceType: 'internal'`, `url: 'internal://email/<email_id>'`, `extractedText: text`, `publishedAt: received date`, `title: 'Note from <from>'`, attached to every competitor named in the text (default: all if none named, logged). Record `reply_received`. Unknown senders (not in `digest.to`) → `ignored`.

9. **Internal notes in the pipeline.** Extraction: for `sourceType = 'internal'`, a prompt variant that sets `attribution = 'internal:<from_email>'` on every fact and requires statements to start with `Per <sender> (internal):`; quotes are still verbatim against the note. Synthesis and insights prompts: "Facts with attribution `internal:*` are what the company's own people told Delta. They are authoritative about the company itself and its customers. About the competitor they are unverified claims: they may raise open questions or move a hypothesis by at most 0.1, must be cited as internal, and must never be stated as the competitor's public behaviour." Code: cap the confidence delta at 0.1 for any update whose cited facts are only internal. UI: `evidence-list.tsx` badge `internal · <sender>`; Evidence tab groups internal notes separately.

10. **Slack (optional)**: `src/lib/digest/slack.ts` posts `{ text, blocks }` to `slack.webhookUrl` (API notes); one `header` block, per competitor a `section` with mrkdwn bullets (`*bold*`, `<url|label>`), max 3 insights each, keep well under Slack's 50-block limit; log the `ok` body; failures do not affect the email.

11. **Events helper** `src/lib/events.ts`: `recordEvent(db, name, props)`; wire `insight_corrected` into `correctInsight`/`correctHypothesis` actions, `source_added` into `/api/sources` and inbound, `insight_viewed` when the dashboard renders an insight that arrived through a signed link (`?via=digest` query param on digest links). Dashboard reactions: add Useful/Wrong/Acted-on buttons to `insight-status.tsx` writing `reactions` with `source = 'dashboard'`.

12. **Tests.** Links (sign/verify/tamper/expiry); reply parsing (quoted-strip fixtures from Gmail/Outlook/Apple Mail, URL extraction, digest id parsing); render snapshot tests for quiet and non-quiet content (assert reaction URLs and section order); inbound handler with a fake Resend client (`webhooks.verify` and `emails.receiving.get` stubs); reaction route idempotency; internal-note confidence cap; gates-before-send holds a digest when a quote is tampered.

## API notes (verified 2026-11-02)

**Resend Node SDK 6.37.0** (`npm install resend`, Node ≥ 20). Send:
```ts
import { Resend } from "resend";
const resend = new Resend(process.env.RESEND_API_KEY);
const { data, error } = await resend.emails.send(
  { from: "Delta <delta@notify.example.com>", to: ["pm@partner.com"], subject, html, text, replyTo: "delta+d12@delta.example.com" },
  { headers: { "Idempotency-Key": "digest-12" } },   // request options are the last argument
);
// data.id on success; error object otherwise. REST: POST https://api.resend.com/emails, Authorization: Bearer <key>.
```
`to` max 50 addresses; `text` is generated from `html` when omitted; `Idempotency-Key` is unique per request and valid 24 h, ≤ 256 chars. The SDK uses camelCase `replyTo` (no `reply_to`).

Receiving: Dashboard → Domains → enable receiving on a **subdomain** (keeps the main domain's mailbox untouched) → copy the MX record shown (host/value vary per domain, e.g. `receive.forge.rmta.net`; it must have the lowest priority) → "I've added the record" → verified. Any address at the subdomain is deliverable, so plus-addressing works. Then Webhooks → Add Webhook → URL `https://<host>/api/webhooks/resend`, event `email.received`.

Webhook payload (metadata only, no body):
```json
{ "type": "email.received", "created_at": "...", "data": { "email_id": "...", "from": "...", "to": ["..."], "cc": [], "bcc": [], "received_for": ["..."], "message_id": "...", "subject": "...", "attachments": [ { "id": "...", "filename": "...", "content_type": "..." } ] } }
```
Verification (raw body required; parsing then re-stringifying breaks the signature):
```ts
const payload = await request.text();
const event = resend.webhooks.verify({
  payload,
  headers: { id: request.headers.get("svix-id")!, timestamp: request.headers.get("svix-timestamp")!, signature: request.headers.get("svix-signature")! },
  webhookSecret: process.env.RESEND_WEBHOOK_SECRET!,
}); // throws when invalid; the secret is on the webhook's page in the dashboard
```
Fetch the body: `const { data } = await resend.emails.receiving.get(email_id)` → `GET https://api.resend.com/emails/receiving/{id}` returning `id, from, to, cc, bcc, reply_to, received_for, subject, message_id, html, text, headers, attachments[], authentication { spf, dkim, dmarc }, raw { download_url }`. Resend stores received mail and retries failed webhook deliveries.

**Next.js**: `import { after } from "next/server"` in route handlers runs after the response; supported with `next start` and Docker; on shutdown the server drains pending `after()` callbacks (allow 10–30 s). Route handlers read raw bodies with `request.text()`; no body-parser config needed.

**Slack incoming webhooks**: create an app → Incoming Webhooks → Add New Webhook to Workspace → pick channel → URL like `https://hooks.slack.com/services/T000/B000/XXXX` (secret, one channel). `POST` JSON `{ "text": "fallback", "blocks": [ { "type": "header", "text": { "type": "plain_text", "text": "Delta weekly" } }, { "type": "section", "text": { "type": "mrkdwn", "text": "*Buffer*\n• <https://…|Partner program launched> — 0.70 ↑" } } ] }`; response body `ok`. Cannot override channel/username; `text` is the notification fallback.

**Node crypto**: `createHmac("sha256", secret).update(payload).digest()`; compare with `timingSafeEqual`.

## Acceptance criteria

- [x] AC1: `npm run digest -- --preview` on the demo database writes an HTML file with three Buffer insights, hypothesis moves with arrows, change lines, and three working reaction URLs per insight; a period with no runs renders the quiet variant.
- [x] AC2 (skipped by Nithan on 2026-11-03: no Resend key or verified domain; send path unit-tested with a fake transport): `npm run digest -- --send` delivers the email through Resend to `digest.to`; `digests.status = 'sent'` with `provider_message_id`; a second send in the same period is a no-op.
- [x] AC3: Clicking a reaction link records exactly one `reactions` row per (insight, digest, kind) and an `insight_reacted` event; the confirmation page accepts a note.
- [x] AC4 (replaced on 2026-11-03: Nithan moved replies from email to a signed note page in the app, which now does this and is unit-tested; the email path was removed): Replying to the digest with a competitor URL and two sentences of context creates (a) a pending snapshot for that URL with `provider = 'manual_url'` and (b) an internal note snapshot; the next run cites the note as `internal · <sender>` and no hypothesis moves more than 0.1 on internal facts alone.
- [x] AC5 (removed on 2026-11-03 with the email reply path; the note page is protected by a signed link instead): A webhook request with a bad signature returns 400 and stores nothing; one from an unknown sender is stored as `ignored`.
- [x] AC6: Tampering a cited quote in the DB makes the digest job hold the digest and email `ops.email`.
- [x] AC7 (verified with a fake fetch; no real webhook URL): With `slack.webhookUrl` set, the digest also posts to Slack; without it nothing is attempted.
- [x] AC8: `npm run check`, `npm test`, `npm run eval:gates` pass; `drizzle/0007_*.sql` committed.
