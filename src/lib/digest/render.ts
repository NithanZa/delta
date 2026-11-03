/**
 * Render the digest to an email: table-based HTML with inline styles, plus a
 * plain-text mirror. Emoji are the icons because email clients strip inline SVG
 * and block remote images by default. No data access: everything comes from
 * `DigestContent`, narrowed by `selectHighlights`.
 */
import type { Insight, ReactionKind } from "@/db/schema";
import type { DigestContent } from "./content";
import { EMPTY_COPY, type DigestCopy } from "./copy";
import { moreInAppLabel, selectAllHighlights, type CompetitorHighlights } from "./highlights";
import type { HypothesisMove } from "./content";

export type RenderOptions = {
  baseUrl: string;
  /** Produces the signed reaction URL for an insight; null when rendering a preview without a digest row. */
  sign: ((insightId: number, kind: ReactionKind) => string) | null;
  /** Signed link to the page where a reader sends a note. */
  replyUrl?: string;
  /** Plain-English wording; anything missing falls back to the pipeline's text. */
  copy?: DigestCopy;
  /** Shown in the subject. */
  dateLabel?: string;
  /** Extra block appended before the footer (phase 12's 30-day question). */
  extraHtml?: string;
  extraText?: string;
};

export type RenderedDigest = { subject: string; html: string; text: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pct = (v: number) => `${Math.round(v * 100)}%`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const parseDate = (iso: string) => new Date(iso);
const shortDate = (iso: string) => {
  const d = parseDate(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};
const fullDate = (iso: string) => {
  const d = parseDate(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};
function dateRange(since: string, until: string): string {
  return fullDate(since) === fullDate(until) ? fullDate(until) : `${fullDate(since)} – ${fullDate(until)}`;
}

/** Shorten at a sentence end where possible, for text the plain-English step did not reach. */
function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sentence = cut.lastIndexOf(". ");
  return sentence > max * 0.4 ? cut.slice(0, sentence + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

/** "Buffer for Agencies | Social media management built for agencies" → "Buffer for Agencies". */
const pageName = (title: string | null, url: string) => (title ?? "").split(/\s+[|–—-]\s+/)[0].trim() || url;

// ── Words and colors for each kind of item ───────────────────────────────────

type Tone = { fg: string; bg: string };
const TONES = {
  red: { fg: "#b91c1c", bg: "#fee2e2" },
  amber: { fg: "#b45309", bg: "#fef3c7" },
  green: { fg: "#047857", bg: "#d1fae5" },
  blue: { fg: "#1d4ed8", bg: "#dbeafe" },
  purple: { fg: "#6d28d9", bg: "#ede9fe" },
  gray: { fg: "#4b5563", bg: "#e5e7eb" },
} satisfies Record<string, Tone>;

const SEVERITY: Record<Insight["severity"], { label: string; icon: string; tone: Tone }> = {
  high: { label: "High priority", icon: "🔴", tone: TONES.red },
  medium: { label: "Worth a look", icon: "🟠", tone: TONES.amber },
  low: { label: "For awareness", icon: "🟢", tone: TONES.green },
};

const MOVE: Record<HypothesisMove["change"], { label: string; icon: string; tone: Tone }> = {
  created: { label: "New theory", icon: "🆕", tone: TONES.blue },
  strengthened: { label: "More likely", icon: "📈", tone: TONES.green },
  weakened: { label: "Less likely", icon: "📉", tone: TONES.amber },
  contradicted: { label: "Now in doubt", icon: "⚠️", tone: TONES.red },
  revised: { label: "Changed our view", icon: "✏️", tone: TONES.purple },
  retired: { label: "Dropped", icon: "🗑️", tone: TONES.gray },
};

/** How sure Delta is, in words a reader can follow. A dropped theory has no number worth showing. */
function confidenceText(m: HypothesisMove): string {
  if (m.change === "retired") return "No longer fits the evidence";
  if (m.prev === null) return `${pct(m.next)} sure`;
  return `was ${pct(m.prev)} sure, now ${pct(m.next)}`;
}

const REACTIONS: { kind: ReactionKind; label: string; icon: string; tone: Tone }[] = [
  { kind: "useful", label: "Useful", icon: "👍", tone: TONES.green },
  { kind: "wrong", label: "Wrong", icon: "👎", tone: TONES.red },
  { kind: "acted_on", label: "Acted on", icon: "✅", tone: TONES.blue },
];

const WORDS = {
  insights: "What to look at",
  moves: "What Delta now thinks",
  changes: "What changed on the web",
  conflicts: "Sources disagree",
};

// ── HTML pieces ──────────────────────────────────────────────────────────────

const font = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
const INK = "#111827";
const BODY = "#374151";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";
const BRAND = "#0f766e";
const BRAND_TINT = "#f0fdfa";
const NIGHT = "#0b0d12";
const TEAL = "#4fd1c5";

const text = (size: number, color: string, extra = "") => `${font}font-size:${size}px;line-height:1.5;color:${color};${extra}`;
const pill = (icon: string, label: string, tone: Tone) => `<span style="${font}display:inline-block;font-size:12px;font-weight:600;line-height:1.4;color:${tone.fg};background:${tone.bg};border-radius:999px;padding:2px 9px;white-space:nowrap;">${icon} ${esc(label)}</span>`;
const button = (href: string, label: string, tone: Tone) => `<a href="${esc(href)}" style="${font}display:inline-block;font-size:13px;font-weight:600;color:${tone.fg};background:${tone.bg};border-radius:6px;padding:6px 12px;margin:0 6px 6px 0;text-decoration:none;">${label}</a>`;
const heading = (icon: string, label: string) => `<tr><td style="padding:18px 24px 8px;"><p style="${text(13, MUTED, "font-weight:700;letter-spacing:.03em;margin:0;")}">${icon}&nbsp; ${esc(label)}</p></td></tr>`;

function insightCard(i: Insight, h: CompetitorHighlights, copy: DigestCopy, opts: RenderOptions, url: (p: string) => string): string {
  const words = copy.insights[i.id] ?? {};
  const severity = SEVERITY[i.severity];
  const action = words.action ?? clip(i.actions[0]?.text ?? i.whatToDoNext, 200);
  const reactions = REACTIONS.map((r) => (opts.sign ? button(opts.sign(i.id, r.kind), `${r.icon} ${r.label}`, r.tone) : "")).join("");
  return `<tr><td style="padding:0 24px 12px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-left:4px solid ${severity.tone.fg};border-radius:8px;"><tr><td style="padding:14px 16px;">
<p style="margin:0 0 8px;">${pill(severity.icon, severity.label, severity.tone)}</p>
<p style="${text(16, INK, "font-weight:700;line-height:1.35;margin:0 0 8px;")}">${esc(words.headline ?? i.title)}</p>
<p style="${text(14, BODY, "margin:0 0 10px;")}">${esc(words.why ?? clip(i.whyItMatters, 280))}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND_TINT};border-radius:6px;"><tr><td style="padding:9px 12px;"><p style="${text(14, INK, "margin:0;")}">👉 <strong>What to do:</strong> ${esc(action)}</p></td></tr></table>
<p style="margin:12px 0 0;">${reactions}<a href="${esc(url(`/c/${h.digest.competitor.slug}?tab=insights&via=digest#i-${i.id}`))}" style="${text(13, BRAND, "font-weight:600;text-decoration:none;white-space:nowrap;")}">🔎 See the evidence</a></p>
</td></tr></table></td></tr>`;
}

function moveRow(m: HypothesisMove, h: CompetitorHighlights, copy: DigestCopy, url: (p: string) => string): string {
  const style = MOVE[m.change];
  return `<tr><td style="padding:0 24px 12px;"><p style="margin:0 0 4px;">${pill(style.icon, style.label, style.tone)} <span style="${text(12, MUTED)}">${esc(confidenceText(m))}</span></p>
<p style="${text(14, BODY, "margin:0;")}">${esc(copy.moves[m.update.id] ?? clip(m.hypothesis.statement, 220))} <a href="${esc(url(`/c/${h.digest.competitor.slug}?tab=overview&via=digest#h-${m.hypothesis.id}`))}" style="color:${BRAND};text-decoration:none;white-space:nowrap;">Why →</a></p></td></tr>`;
}

function competitorHtml(h: CompetitorHighlights, copy: DigestCopy, opts: RenderOptions, url: (p: string) => string): string {
  const c = h.digest;
  const parts: string[] = [];
  const checked = c.pagesChecked > 0 ? `Delta checked ${plural(c.pagesChecked, "page")} and ${c.pagesChanged === 0 ? "none had" : `${c.pagesChanged} had`} changed.` : "";
  parts.push(`<tr><td style="padding:22px 24px 4px;border-top:1px solid ${LINE};"><p style="${text(20, INK, "font-weight:700;line-height:1.3;margin:0;")}">${esc(c.competitor.name)}</p>${checked ? `<p style="${text(13, MUTED, "margin:2px 0 0;")}">${esc(checked)}</p>` : ""}</td></tr>`);

  if (h.insights.length) {
    parts.push(heading("🎯", WORDS.insights));
    for (const i of h.insights) parts.push(insightCard(i, h, copy, opts, url));
  }
  if (h.moves.length) {
    parts.push(heading("🧭", WORDS.moves));
    for (const m of h.moves) parts.push(moveRow(m, h, copy, url));
  }
  if (h.changes.length) {
    parts.push(heading("📝", WORDS.changes));
    for (const ch of h.changes) {
      const when = ch.previousSnapshot ? `${fullDate(ch.previousSnapshot.publishedAt)} → ${fullDate(ch.snapshot.publishedAt)}` : fullDate(ch.snapshot.publishedAt);
      parts.push(`<tr><td style="padding:0 24px 12px;"><p style="${text(14, BODY, "margin:0 0 2px;")}">${esc(copy.changes[ch.fact.id] ?? clip(ch.fact.statement, 220))}</p><p style="${text(12, MUTED, "margin:0;")}"><a href="${esc(url(`/c/${c.competitor.slug}?tab=evidence&facts=${ch.fact.id}&via=digest`))}" style="color:${BRAND};text-decoration:none;">${esc(pageName(ch.snapshot.title, ch.snapshot.url))}</a> · ${esc(when)}</p></td></tr>`);
    }
  }
  if (h.conflicts.length) {
    parts.push(heading("⚖️", WORDS.conflicts));
    for (const q of h.conflicts) parts.push(`<tr><td style="padding:0 24px 12px;"><p style="${text(14, BODY, "margin:0;")}">${esc(copy.conflicts[q.id] ?? clip(q.question, 220))}</p></td></tr>`);
  }
  const more = moreInAppLabel(h.more);
  if (more) {
    parts.push(`<tr><td style="padding:0 24px 12px;"><p style="${text(13, MUTED, "margin:0;")}">🔎 Also important: <a href="${esc(url(`/c/${c.competitor.slug}?via=digest`))}" style="color:${BRAND};font-weight:600;text-decoration:none;">${esc(more)} in Delta →</a></p></td></tr>`);
  }
  return parts.join("\n");
}

// ── Plain text ───────────────────────────────────────────────────────────────

function competitorText(h: CompetitorHighlights, copy: DigestCopy, opts: RenderOptions, url: (p: string) => string): string {
  const c = h.digest;
  const out: string[] = [`## ${c.competitor.name}`];
  if (c.pagesChecked > 0) out.push(`Delta checked ${plural(c.pagesChecked, "page")} and ${c.pagesChanged === 0 ? "none had" : `${c.pagesChanged} had`} changed.`);
  out.push("");
  if (h.insights.length) {
    out.push(WORDS.insights);
    for (const i of h.insights) {
      const words = copy.insights[i.id] ?? {};
      out.push(`- [${SEVERITY[i.severity].label}] ${words.headline ?? i.title}`, `  ${words.why ?? clip(i.whyItMatters, 280)}`, `  What to do: ${words.action ?? clip(i.actions[0]?.text ?? i.whatToDoNext, 200)}`);
      if (opts.sign) for (const r of REACTIONS) out.push(`  ${r.label}: ${opts.sign(i.id, r.kind)}`);
      out.push(`  See the evidence: ${url(`/c/${c.competitor.slug}?tab=insights&via=digest#i-${i.id}`)}`);
    }
    out.push("");
  }
  if (h.moves.length) {
    out.push(WORDS.moves);
    for (const m of h.moves) out.push(`- [${MOVE[m.change].label}, ${confidenceText(m)}] ${copy.moves[m.update.id] ?? clip(m.hypothesis.statement, 220)}`);
    out.push("");
  }
  if (h.changes.length) {
    out.push(WORDS.changes);
    for (const ch of h.changes) out.push(`- ${copy.changes[ch.fact.id] ?? clip(ch.fact.statement, 220)} (${pageName(ch.snapshot.title, ch.snapshot.url)}, ${fullDate(ch.snapshot.publishedAt)})`);
    out.push("");
  }
  if (h.conflicts.length) {
    out.push(WORDS.conflicts);
    for (const q of h.conflicts) out.push(`- ${copy.conflicts[q.id] ?? clip(q.question, 220)}`);
    out.push("");
  }
  const more = moreInAppLabel(h.more);
  if (more) out.push(`Also important: ${more} in Delta: ${url(`/c/${c.competitor.slug}?via=digest`)}`, "");
  return out.join("\n");
}

// ── The whole email ──────────────────────────────────────────────────────────

export function renderDigest(content: DigestContent, opts: RenderOptions): RenderedDigest {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const url = (path: string) => `${base}${path}`;
  const company = content.company?.name ?? "your company";
  const copy = opts.copy ?? EMPTY_COPY;
  const subject = `Delta weekly · ${company} · ${opts.dateLabel ?? shortDate(content.period.until)}${content.quiet ? " · quiet week" : ""}`;
  const period = dateRange(content.period.since, content.period.until);

  const highlights = selectAllHighlights(content.competitors);
  const withNews = highlights.filter((h) => h.hasNews);
  const without = highlights.filter((h) => !h.hasNews);
  const totalChecked = content.competitors.reduce((n, c) => n + c.pagesChecked, 0);
  const quietLine = totalChecked > 0 ? `Nothing important changed this week. Delta checked ${plural(totalChecked, "page")} across ${plural(content.competitors.length, "competitor")}.` : "Nothing important changed this week.";
  const nothingAt = without.length ? `Nothing notable at ${without.map((h) => h.digest.competitor.name).join(", ")} this week.` : "";
  const sentBy = `Sent by Delta, a weekly competitor digest for ${company}.`;
  const noReplies = "Replies to this email aren't read, so please use the button above.";

  const body = content.quiet
    ? `<tr><td style="padding:24px;"><p style="${text(15, BODY, "margin:0;")}">😌 ${esc(quietLine)}</p></td></tr>`
    : [
        copy.intro ? `<tr><td style="padding:20px 24px 18px;"><p style="${text(15, INK, "margin:0;")}">${esc(copy.intro)}</p></td></tr>` : "",
        ...withNews.map((h) => competitorHtml(h, copy, opts, url)),
        nothingAt ? `<tr><td style="padding:16px 24px;border-top:1px solid ${LINE};"><p style="${text(13, MUTED, "margin:0;")}">😌 ${esc(nothingAt)}</p></td></tr>` : "",
      ].join("\n");

  const noteBox = opts.replyUrl
    ? `<tr><td style="padding:18px 24px;background:${BRAND_TINT};border-top:1px solid ${LINE};"><p style="${text(15, INK, "font-weight:700;margin:0 0 2px;")}">💬 Know something Delta missed?</p><p style="${text(14, BODY, "margin:0 0 10px;")}">Send a note or a link and Delta will use it in next week's analysis.</p><a href="${esc(opts.replyUrl)}" style="${font}display:inline-block;font-size:14px;font-weight:600;color:#ffffff;background:${BRAND};border-radius:6px;padding:8px 16px;text-decoration:none;">Send a note →</a></td></tr>`
    : "";

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"></head><body style="margin:0;padding:0;background:#f3f4f6;">
<div style="display:none;max-height:0;overflow:hidden;">${esc(copy.intro ?? (content.quiet ? quietLine : `What changed at your competitors, ${period}.`))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:12px;border:1px solid ${LINE};overflow:hidden;">
<tr><td style="padding:20px 24px;background:${NIGHT};border-radius:12px 12px 0 0;"><p style="${font}font-size:20px;font-weight:700;line-height:1.3;color:#ffffff;margin:0;"><span style="color:${TEAL};">Δ</span> Delta weekly</p><p style="${font}font-size:13px;line-height:1.4;color:#d1d5db;margin:4px 0 0;">For ${esc(company)} · ${esc(period)}${content.quiet ? " · quiet week" : ""}</p></td></tr>
${body}
${opts.extraHtml ? `<tr><td style="padding:18px 24px;background:${TONES.amber.bg};border-top:1px solid ${LINE};">${opts.extraHtml}</td></tr>` : ""}
${noteBox}
<tr><td style="padding:14px 24px 20px;border-top:1px solid ${LINE};"><p style="${text(12, MUTED, "margin:0 0 4px;")}">${esc(sentBy)}${opts.replyUrl ? ` ${esc(noReplies)}` : ""}</p><p style="${text(12, MUTED, "margin:0;")}"><a href="${esc(url("/digests"))}" style="color:${BRAND};text-decoration:none;">View this digest in the browser</a></p></td></tr>
</table></td></tr></table></body></html>`;

  const plain = [
    `Delta weekly for ${company} · ${period}${content.quiet ? " · quiet week" : ""}`,
    "",
    ...(content.quiet ? [quietLine] : [...(copy.intro ? [copy.intro, ""] : []), ...withNews.map((h) => competitorText(h, copy, opts, url)), ...(nothingAt ? [nothingAt] : [])]),
    opts.extraText ? `\n${opts.extraText}\n` : "",
    ...(opts.replyUrl ? [`Know something Delta missed? Send a note or a link: ${opts.replyUrl}`, ""] : []),
    opts.replyUrl ? `${sentBy} Replies to this email aren't read, so please use the link above.` : sentBy,
    `View this digest in the browser: ${url("/digests")}`,
  ].join("\n");

  return { subject, html, text: plain };
}
