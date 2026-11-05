/**
 * The digest job: build the content for the period since the last sent
 * digest, render it, run the zero-tolerance gates on everything it cites,
 * then send (or hold it and tell ops).
 */
import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { Digest, ReactionKind } from "@/db/schema";
import { runFactGates } from "../../../eval/lib/gates";
import { writeLabelSample } from "../../../eval/lib/sampler";
import { recordEvent } from "@/lib/events";
import { reactionUrl, replyUrl, signReaction, signReply } from "@/lib/links";
import type { LlmClient } from "@/lib/llm/client";
import { getSetting } from "@/lib/settings";
import { buildDigestContent, type DigestContent, type DigestPeriod } from "./content";
import { writeDigestCopy } from "./copy";
import { selectAllHighlights } from "./highlights";
import { renderDigest, type RenderedDigest } from "./render";
import { FakeSender, type EmailSender } from "./send";
import { postToSlack } from "./slack";
import { DECISION_QUESTION_EVERY } from "./thresholds";

export type DigestJobOptions = {
  now?: Date;
  /** Override the period start (e.g. --since). */
  since?: string;
  sender?: EmailSender;
  /** Render and gate, write a preview file, send nothing. */
  preview?: boolean;
  previewDir?: string;
  log?: (m: string) => void;
  fetchImpl?: typeof fetch;
  /** Extra block for a digest; defaults to the 30-day decision question on every fourth digest. */
  extra?: (sequence: number, replyLink: string) => { html: string; text: string } | null;
  /** Writes the plain-English wording; defaults to the configured model. */
  client?: LlmClient;
  /** Where weekly labeling sheets go (under the data volume so they survive redeploys). */
  labelsDir?: string;
};

export const DECISION_QUESTION = "One question after four weeks: did anything Delta surfaced change what you investigated, discussed, recommended, or decided? Tell us which insight it was and what you did differently.";

export function decisionQuestionBlock(sequence: number, replyLink: string): { html: string; text: string } | null {
  if (sequence % DECISION_QUESTION_EVERY !== 0) return null;
  const font = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
  return {
    html: `<p style="${font}font-size:14px;line-height:1.5;color:#1f2937;margin:0 0 10px;">🙋 <strong>${DECISION_QUESTION.split(":")[0]}:</strong>${DECISION_QUESTION.slice(DECISION_QUESTION.indexOf(":") + 1)}</p><a href="${replyLink.replace(/&/g, "&amp;")}" style="${font}display:inline-block;font-size:14px;font-weight:600;color:#ffffff;background:#b45309;border-radius:6px;padding:8px 16px;text-decoration:none;">Answer in Delta →</a>`,
    text: `${DECISION_QUESTION}\nAnswer here: ${replyLink}`,
  };
}

/** The digest row keeps what rendering and Slack need; page bodies stay in the snapshots table. */
export function slimContent(content: DigestContent): DigestContent {
  return {
    ...content,
    competitors: content.competitors.map((c) => ({
      ...c,
      changes: c.changes.map((ch) => ({
        ...ch,
        snapshot: { ...ch.snapshot, rawHtml: "", extractedText: "" },
        previousSnapshot: ch.previousSnapshot ? { ...ch.previousSnapshot, rawHtml: "", extractedText: "" } : undefined,
      })),
    })),
  };
}

export type DigestJobResult = { digest: Digest | null; status: "sent" | "held" | "failed" | "preview" | "noop"; reasons: string[]; previewFile?: string };

/** Everything a digest cites: the facts behind its hypothesis moves, insights and change lines. */
export function citedFactIds(content: DigestContent): number[] {
  const ids = new Set<number>();
  for (const c of content.competitors) {
    for (const m of c.hypothesesMoved) for (const id of m.update.factIds) ids.add(id);
    for (const i of c.topInsights) for (const id of i.factIds) ids.add(id);
    for (const ch of c.changes) ids.add(ch.fact.id);
  }
  return [...ids];
}

/** Pre-send trust checks: quotes verbatim, nothing from after a run's cutoff, no near-duplicate titles. */
export function preSendReasons(db: Db, content: DigestContent): string[] {
  const reasons: string[] = [];
  const ids = citedFactIds(content);
  if (ids.length) {
    const report = runFactGates(db, ids);
    for (const r of report.results) if (r.violations.length) reasons.push(`${r.id} ${r.name}: ${r.violations.slice(0, 5).join(", ")}`);
  }
  const titles = content.competitors.flatMap((c) => c.topInsights.map((i) => ({ id: i.id, tokens: new Set(i.title.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2)) })));
  for (let a = 0; a < titles.length; a++) {
    for (let b = a + 1; b < titles.length; b++) {
      const inter = [...titles[a].tokens].filter((t) => titles[b].tokens.has(t)).length;
      const union = new Set([...titles[a].tokens, ...titles[b].tokens]).size;
      if (union > 0 && inter / union >= 0.6) reasons.push(`Duplicate insight titles I${titles[a].id} and I${titles[b].id}`);
    }
  }
  return reasons;
}

export function lastSentDigest(db: Db): Digest | undefined {
  return db.select().from(schema.digests).where(and(eq(schema.digests.channel, "email"), eq(schema.digests.status, "sent"))).orderBy(desc(schema.digests.id)).get();
}

function firstRunDate(db: Db): string | null {
  const first = db.select({ startedAt: schema.runs.startedAt, finishedAt: schema.runs.finishedAt }).from(schema.runs).orderBy(schema.runs.id).get();
  return first?.startedAt ?? first?.finishedAt ?? null;
}

export function nextDigestPeriod(db: Db, opts: { now?: Date; since?: string } = {}): DigestPeriod {
  const until = (opts.now ?? new Date()).toISOString();
  const since = opts.since ?? lastSentDigest(db)?.periodEnd ?? firstRunDate(db) ?? "0000-01-01T00:00:00.000Z";
  return { since, until };
}

export async function runDigestJob(db: Db, opts: DigestJobOptions = {}): Promise<DigestJobResult> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? new Date();
  const baseUrl = getSetting(db, "app.baseUrl");
  const period = nextDigestPeriod(db, { now, since: opts.since });
  const content = buildDigestContent(db, period);
  const sequence = (lastSentDigest(db)?.sequence ?? 0) + 1;
  const highlights = selectAllHighlights(content.competitors);
  const copy = content.quiet ? undefined : await writeDigestCopy(highlights, content.company?.name ?? "your company", { client: opts.client, log });
  log(`period ${period.since.slice(0, 10)} → ${period.until.slice(0, 10)}, ${content.competitors.length} competitor(s), ${content.quiet ? "quiet" : "news"}`);

  if (opts.preview) {
    const replyLink = replyUrl(baseUrl, signReply(0));
    const extra = (opts.extra ?? decisionQuestionBlock)(sequence, replyLink);
    const rendered = renderDigest(content, { baseUrl, sign: (i, k) => reactionUrl(baseUrl, signReaction({ digestId: 0, insightId: i, kind: k })), replyUrl: replyLink, copy, extraHtml: extra?.html, extraText: extra?.text });
    const dir = opts.previewDir ?? path.resolve(process.cwd(), "data", "digests");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `preview-${now.toISOString().slice(0, 10)}.html`);
    fs.writeFileSync(file, rendered.html);
    fs.writeFileSync(file.replace(/\.html$/, ".txt"), rendered.text);
    const reasons = preSendReasons(db, content);
    log(`preview written to ${path.relative(process.cwd(), file)}${reasons.length ? `; would be HELD: ${reasons.join("; ")}` : ""}`);
    return { digest: null, status: "preview", reasons, previewFile: file };
  }

  const recipients = getSetting(db, "digest.to");
  if (recipients.length === 0) {
    log("no recipients configured (digest.to); nothing sent");
    return { digest: null, status: "noop", reasons: ["digest.to is empty"] };
  }
  // A second send in the same period is a no-op.
  const last = lastSentDigest(db);
  if (last && last.periodEnd >= period.since && content.competitors.every((c) => c.runs.length === 0) && last.periodEnd.slice(0, 10) === period.until.slice(0, 10)) {
    log(`digest #${last.id} already covers this period; nothing sent`);
    return { digest: last, status: "noop", reasons: ["already sent for this period"] };
  }

  // Insert first so the signed links carry the real digest id.
  const draft = db
    .insert(schema.digests)
    .values({ sequence, periodStart: period.since, periodEnd: period.until, status: "draft", channel: "email", subject: "", html: "", text: "", content: slimContent(content) as unknown, recipients })
    .returning()
    .get();
  const sign = (insightId: number, kind: ReactionKind) => reactionUrl(baseUrl, signReaction({ digestId: draft.id, insightId, kind }));
  const replyLink = replyUrl(baseUrl, signReply(draft.id));
  const extra = (opts.extra ?? decisionQuestionBlock)(sequence, replyLink);
  const rendered: RenderedDigest = renderDigest(content, { baseUrl, sign, replyUrl: replyLink, copy, extraHtml: extra?.html, extraText: extra?.text });
  db.update(schema.digests).set({ subject: rendered.subject, html: rendered.html, text: rendered.text }).where(eq(schema.digests.id, draft.id)).run();
  let rank = 0;
  for (const h of highlights) for (const i of h.insights) db.insert(schema.digestItems).values({ digestId: draft.id, competitorId: h.digest.competitor.id, insightId: i.id, rank: ++rank }).run();

  const reasons = preSendReasons(db, content);
  const sender = opts.sender ?? new FakeSender();
  if (reasons.length) {
    const held = db.update(schema.digests).set({ status: "held", error: reasons.join("; ") }).where(eq(schema.digests.id, draft.id)).returning().get();
    log(`HELD digest #${held.id}: ${reasons.join("; ")}`);
    await notifyOps(db, sender, `Delta digest #${held.id} held`, `The digest for ${period.since.slice(0, 10)} → ${period.until.slice(0, 10)} failed its pre-send checks:\n\n${reasons.map((r) => `- ${r}`).join("\n")}\n\nReview it at ${baseUrl}/ops and send it anyway from there once fixed.`, log);
    return { digest: held, status: "held", reasons };
  }
  const result = await sendDigest(db, draft.id, { sender, log, fetchImpl: opts.fetchImpl });
  if (result.status === "sent") {
    // The operator's weekly chore: a labeling sheet for what this digest period produced.
    try {
      const out = path.join(opts.labelsDir ?? path.resolve(process.cwd(), "data", "labels"), `${now.toISOString().slice(0, 10)}.csv`);
      const sheet = writeLabelSample(db, { since: period.since, n: 25, out, seed: `digest-${draft.id}` });
      log(sheet ? `labeling sheet: ${sheet.rows} row(s) in ${path.relative(process.cwd(), sheet.file)}` : "labeling sheet: no runs in this period");
    } catch (e) {
      log(`labeling sheet failed (digest unaffected): ${(e as Error).message}`);
    }
  }
  return result;
}

/** Send a draft or held digest (also used by "Send anyway" on /ops). */
export async function sendDigest(db: Db, digestId: number, opts: { sender: EmailSender; log?: (m: string) => void; fetchImpl?: typeof fetch; override?: string }): Promise<DigestJobResult> {
  const log = opts.log ?? (() => {});
  const digest = db.select().from(schema.digests).where(eq(schema.digests.id, digestId)).get();
  if (!digest) return { digest: null, status: "failed", reasons: ["digest not found"] };
  const from = getSetting(db, "digest.from");
  const baseUrl = getSetting(db, "app.baseUrl");
  try {
    const { id } = await opts.sender.send({
      from,
      to: digest.recipients,
      subject: digest.subject,
      html: digest.html,
      text: digest.text,
      idempotencyKey: `digest-${digest.id}`,
    });
    const sent = db.update(schema.digests).set({ status: "sent", sentAt: new Date().toISOString(), providerMessageId: id, error: null }).where(eq(schema.digests.id, digest.id)).returning().get();
    recordEvent(db, "digest_sent", { digestId: digest.id, sequence: digest.sequence, recipients: digest.recipients.length, override: opts.override ?? null });
    log(`sent digest #${digest.id} (${digest.subject}) to ${digest.recipients.join(", ")} → ${id}`);
    const webhook = getSetting(db, "slack.webhookUrl");
    if (webhook) {
      try {
        const body = await postToSlack(webhook, digest.content as DigestContent, baseUrl, opts.fetchImpl);
        log(`slack: ${body}`);
      } catch (e) {
        log(`slack failed (email unaffected): ${(e as Error).message}`);
      }
    }
    return { digest: sent, status: "sent", reasons: [] };
  } catch (e) {
    const failed = db.update(schema.digests).set({ status: "failed", error: (e as Error).message }).where(eq(schema.digests.id, digest.id)).returning().get();
    log(`FAILED digest #${digest.id}: ${(e as Error).message}`);
    await notifyOps(db, opts.sender, `Delta digest #${digest.id} failed`, `Sending failed: ${(e as Error).message}`, log);
    return { digest: failed, status: "failed", reasons: [(e as Error).message] };
  }
}

/** Returns whether the email went out. */
export async function notifyOps(db: Db, sender: EmailSender, subject: string, text: string, log: (m: string) => void): Promise<boolean> {
  const ops = getSetting(db, "ops.email");
  if (!ops) return false;
  try {
    await sender.send({ from: getSetting(db, "digest.from"), to: [ops], subject, html: `<pre style="font-family:monospace">${text.replace(/</g, "&lt;")}</pre>`, text, idempotencyKey: `ops-${subject}-${Date.now()}` });
    return true;
  } catch (e) {
    log(`could not notify ops: ${(e as Error).message}`);
    return false;
  }
}

export function listDigests(db: Db, limit = 50): Digest[] {
  return db.select().from(schema.digests).orderBy(desc(schema.digests.id)).limit(limit).all();
}

export function heldDigests(db: Db): Digest[] {
  return db.select().from(schema.digests).where(inArray(schema.digests.status, ["held", "failed"])).orderBy(desc(schema.digests.id)).all();
}
