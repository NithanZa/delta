import { Badge, Card, SectionTitle, fmtDate } from "@/components/ui";
import { ConfidenceMove } from "@/components/run-delta";
import type { DigestContent } from "@/lib/digest/content";
import { effectiveScore } from "@/lib/digest/content";

/** "Since the previous run" summary built from the digest content model (the same model the email digest renders). */
export function SinceStrip({ slug, content }: { slug: string; content: DigestContent }) {
  const c = content.competitors[0];
  if (!c) return null;
  const moved = c.hypothesesMoved.filter((m) => m.prev === null || Math.abs(m.next - m.prev) >= 0.1);
  const sinceLabel = content.period.since.startsWith("0000") ? "the start" : fmtDate(content.period.since);
  return (
    <section aria-labelledby="since-strip-title" data-testid="since-strip">
      <SectionTitle right={content.quiet ? <Badge tone="neutral">quiet period</Badge> : <Badge tone="accent">news</Badge>}>
        <span id="since-strip-title">Since {sinceLabel} (digest view)</span>
      </SectionTitle>
      <Card className="grid gap-3 text-sm">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <span>
            <span className="font-semibold tabular-nums text-fg">{c.runs.length}</span> run{c.runs.length === 1 ? "" : "s"}
          </span>
          <span>
            <span className="font-semibold tabular-nums text-fg">{c.changes.length}</span> page change{c.changes.length === 1 ? "" : "s"}
          </span>
          <span>
            <span className="font-semibold tabular-nums text-fg">{c.pagesChecked}</span> pages checked · <span className="font-semibold tabular-nums text-fg">{c.pagesChanged}</span> changed
          </span>
          <span>
            <span className="font-semibold tabular-nums text-fg">{c.questionsRaised.length}</span> question{c.questionsRaised.length === 1 ? "" : "s"} raised
            {c.conflicts.length > 0 && <> · <span className="font-semibold tabular-nums text-bad">{c.conflicts.length}</span> conflict{c.conflicts.length === 1 ? "" : "s"}</>}
          </span>
        </div>
        {c.topInsights.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Top insights</p>
            <ul className="grid gap-1">
              {c.topInsights.map((i) => (
                <li key={i.id} className="flex flex-wrap items-baseline gap-2">
                  <Badge tone={i.severity === "high" ? "bad" : i.severity === "medium" ? "warn" : "neutral"}>{i.severity}</Badge>
                  <a href={`/c/${slug}?tab=insights#i-${i.id}`} className="hover:text-accent hover:underline">
                    {i.title}
                  </a>
                  <span className="text-xs tabular-nums text-muted" title={i.scoreBreakdown ? `relevance ${i.scoreBreakdown.relevance.toFixed(2)} · novelty ${i.scoreBreakdown.novelty.toFixed(2)} · evidence ${i.scoreBreakdown.evidence.toFixed(2)} · actionability ${i.scoreBreakdown.actionability.toFixed(2)}` : "unscored (written before ranking existed)"}>
                    score {effectiveScore(i).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {moved.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Hypotheses that moved</p>
            <ul className="grid gap-1">
              {moved.slice(0, 6).map((m) => (
                <li key={m.update.id} className="flex flex-wrap items-baseline gap-2">
                  <Badge>{m.change}</Badge>
                  <a href={`#h-${m.hypothesis.id}`} className="text-xs font-semibold text-accent hover:underline">
                    H{m.hypothesis.id}
                  </a>
                  <span className="min-w-0 flex-1 truncate">{m.hypothesis.statement}</span>
                  <ConfidenceMove prev={m.prev} next={m.next} />
                </li>
              ))}
            </ul>
          </div>
        )}
        {content.quiet && <p className="text-xs text-muted">Nothing met the digest thresholds in this period: no top insight, no hypothesis move of 10 points or more, no important page change.</p>}
      </Card>
    </section>
  );
}
