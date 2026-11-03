/**
 * Optional Slack mirror of the digest through an incoming webhook
 * (POST { text, blocks }; response body "ok").
 */
import type { CompetitorDigest, DigestContent } from "./content";
import { selectHighlights } from "./highlights";

type Block = { type: "header"; text: { type: "plain_text"; text: string } } | { type: "section"; text: { type: "mrkdwn"; text: string } } | { type: "divider" };

const mrkdwn = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pct = (v: number) => `${Math.round(v * 100)}%`;

function competitorBlock(c: CompetitorDigest, baseUrl: string): Block {
  const h = selectHighlights(c);
  const lines: string[] = [`*${mrkdwn(c.competitor.name)}*${c.pagesChecked > 0 ? ` · ${c.pagesChecked} pages checked, ${c.pagesChanged} changed` : ""}`];
  for (const i of h.insights) lines.push(`• <${baseUrl}/c/${c.competitor.slug}?tab=insights&via=slack#i-${i.id}|${mrkdwn(i.title)}> (${i.severity} priority)`);
  for (const m of h.moves) lines.push(`• ${m.change === "retired" ? "Dropped" : m.prev === null ? `New, ${pct(m.next)} sure` : `Was ${pct(m.prev)} sure, now ${pct(m.next)}`}: ${mrkdwn(m.hypothesis.statement.slice(0, 120))}`);
  if (c.conflicts.length) lines.push(`• Sources disagree on ${c.conflicts.length} point${c.conflicts.length === 1 ? "" : "s"}`);
  return { type: "section", text: { type: "mrkdwn", text: lines.join("\n").slice(0, 2900) } };
}

export function slackMessage(content: DigestContent, baseUrl: string): { text: string; blocks: Block[] } {
  const company = content.company?.name ?? "your company";
  const title = `Delta weekly · ${company}${content.quiet ? " · quiet week" : ""}`;
  const blocks: Block[] = [{ type: "header", text: { type: "plain_text", text: title.slice(0, 150) } }];
  if (content.quiet) {
    const checked = content.competitors.reduce((n, c) => n + c.pagesChecked, 0);
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `Nothing material changed. ${checked} pages checked across ${content.competitors.length} competitor(s).` } });
  } else {
    for (const c of content.competitors) {
      blocks.push(competitorBlock(c, baseUrl.replace(/\/+$/, "")));
      blocks.push({ type: "divider" });
    }
  }
  blocks.push({ type: "section", text: { type: "mrkdwn", text: `<${baseUrl.replace(/\/+$/, "")}/digests|View the full digest>` } });
  return { text: title, blocks: blocks.slice(0, 45) };
}

export async function postToSlack(webhookUrl: string, content: DigestContent, baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(slackMessage(content, baseUrl)) });
  const body = await res.text();
  if (!res.ok) throw new Error(`Slack webhook returned HTTP ${res.status}: ${body.slice(0, 200)}`);
  return body;
}
