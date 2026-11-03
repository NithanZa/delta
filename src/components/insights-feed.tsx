import type { Insight } from "@/db/schema";
import { Badge, Card, EmptyState, cx, type BadgeTone } from "@/components/ui";
import { EvidenceList } from "@/components/evidence-list";
import { CorrectionForm } from "@/components/correction-form";
import { InsightStatusButtons } from "@/components/insight-status";
import { runLabel } from "@/components/overview";
import { linkRefs } from "@/components/refs";
import { correctInsight } from "@/app/c/[slug]/actions";
import { effectiveScore } from "@/lib/digest/content";
import type { Workspace } from "@/lib/queries";
import { factMap, insightChain, snapshotMap } from "@/lib/queries";

const severityTone: Record<Insight["severity"], BadgeTone> = { high: "bad", medium: "warn", low: "neutral" };

function scoreTitle(i: Insight): string {
  if (!i.scoreBreakdown) return "Unscored: written before ranking existed";
  const b = i.scoreBreakdown;
  return `relevance ${b.relevance.toFixed(2)} ×0.35 · novelty ${b.novelty.toFixed(2)} ×0.25 · evidence ${b.evidence.toFixed(2)} ×0.25 · actionability ${b.actionability.toFixed(2)} ×0.15${i.relevanceNote ? `\n${i.relevanceNote}` : ""}`;
}

export function InsightsFeed({ ws, companyName }: { ws: Workspace; companyName: string }) {
  const facts = factMap(ws.facts);
  const snapshots = snapshotMap(ws.snapshots);
  if (ws.insights.length === 0) return <EmptyState title="No insights yet">Insights appear after a run: what happened, what it might mean, why it matters to {companyName}, and what to do next.</EmptyState>;

  // Superseded insights are shown as history under the insight that replaced them.
  const heads = ws.insights.filter((i) => i.status !== "superseded");
  const sorted = [...heads].sort((a, b) => effectiveScore(b) - effectiveScore(a) || b.runId - a.runId || a.id - b.id);

  return (
    <div className="grid gap-4">
      {sorted.map((i) => {
        const history = insightChain(ws.insights, i);
        return (
          <Card key={i.id} id={`i-${i.id}`} className={cx(i.status === "dismissed" && "border-dashed bg-surface/60")}>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={severityTone[i.severity]}>{i.severity}</Badge>
              <Badge tone="accent">{runLabel(ws.runs, i.runId)}</Badge>
              <Badge tone={i.score === null ? "neutral" : effectiveScore(i) >= 0.7 ? "ok" : "info"} className="cursor-help" title={scoreTitle(i)}>
                score {effectiveScore(i).toFixed(2)}
              </Badge>
              {i.status !== "new" && <Badge>{i.status}</Badge>}
              {history.length > 0 && <Badge tone="info">updated · replaces I{history[0].id}</Badge>}
              {i.userCorrection && <Badge tone="accent">corrected by you</Badge>}
              <span className="ml-auto text-[11px] text-muted">I{i.id}</span>
            </div>
            <h3 id={`i-${i.id}-title`} className={cx("mt-2 text-lg font-semibold leading-snug", i.status === "dismissed" && "line-through")}>
              {i.title}
            </h3>
            {i.relevanceNote && <p className="mt-1 text-xs text-muted">Relevant to: {i.relevanceNote}</p>}

            <dl className="mt-3 grid gap-3">
              <Section label="Observed · facts with quotes" accent>
                {linkRefs(i.whatHappened, ws.competitor.slug)}
              </Section>
              <Section label="Inferred · Delta's interpretation">{linkRefs(i.whatItMeans, ws.competitor.slug)}</Section>
              <Section label={`Why it matters to ${companyName}`}>{linkRefs(i.whyItMatters, ws.competitor.slug)}</Section>
              <Section label="Recommended · what to do next">
                {linkRefs(i.whatToDoNext, ws.competitor.slug)}
                {i.actions.length > 0 && (
                  <ul className="mt-2 grid gap-2">
                    {i.actions.map((a, idx) => (
                      <li key={idx} className="flex gap-2 rounded-md border border-line bg-bg p-2.5 text-sm">
                        <Badge tone={a.type === "investigate" ? "info" : "accent"} className="h-fit shrink-0">
                          {a.type}
                        </Badge>
                        <div>
                          <p>{a.text}</p>
                          {a.rationale && <p className="mt-1 text-xs text-muted">{a.rationale}</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </dl>

            {i.userCorrection && (
              <p className="mt-3 rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-accent">Your correction</span>
                <br />
                {i.userCorrection}
              </p>
            )}
            {history.some((h) => h.userCorrection) && (
              <p className="mt-3 rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-accent">Your correction on the earlier version</span>
                <br />
                {history.find((h) => h.userCorrection)!.userCorrection}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-xs">
              {i.hypothesisIds.length > 0 && (
                <span className="text-muted">
                  Hypotheses:{" "}
                  {i.hypothesisIds.map((hid, idx) => (
                    <span key={hid}>
                      {idx > 0 && ", "}
                      <a href={`/c/${ws.competitor.slug}?tab=overview#h-${hid}`} className="text-accent hover:underline">
                        H{hid}
                      </a>
                    </span>
                  ))}
                </span>
              )}
              <InsightStatusButtons slug={ws.competitor.slug} id={i.id} status={i.status} title={i.title} reacted={ws.reactions.filter((r) => r.insightId === i.id).map((r) => r.kind)} />
              <CorrectionForm slug={ws.competitor.slug} id={i.id} action={correctInsight} current={i.userCorrection} ariaLabel={`Correct insight: ${i.title}`} />
            </div>

            {i.factIds.length > 0 && (
              <details className="mt-3">
                <summary className="text-xs text-accent hover:underline">
                  {i.factIds.length} fact{i.factIds.length === 1 ? "" : "s"} with verbatim quotes
                </summary>
                <div className="mt-2">
                  <EvidenceList factIds={i.factIds} facts={facts} snapshots={snapshots} compact />
                </div>
              </details>
            )}

            {history.length > 0 && (
              <details className="mt-3">
                <summary className="text-xs text-muted hover:text-fg">
                  History · {history.length} earlier version{history.length === 1 ? "" : "s"} this insight replaced
                </summary>
                <ol className="mt-2 grid gap-2 border-l border-line pl-3">
                  {history.map((h) => (
                    <li key={h.id} id={`i-${h.id}`} className="text-sm">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone="neutral">I{h.id}</Badge>
                        <Badge tone="accent">{runLabel(ws.runs, h.runId)}</Badge>
                        <Badge tone={severityTone[h.severity]}>{h.severity}</Badge>
                      </div>
                      <p className="mt-1 font-medium">{h.title}</p>
                      <p className="mt-0.5 text-xs text-muted">{h.whatToDoNext}</p>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function Section({ label, accent, children }: { label: string; accent?: boolean; children: React.ReactNode }) {
  return (
    <div className={cx("border-l-2 pl-3", accent ? "border-accent" : "border-line")}>
      <dt className={cx("text-[11px] font-semibold uppercase tracking-wide", accent ? "text-accent" : "text-muted")}>{label}</dt>
      <dd className="mt-0.5 text-sm leading-relaxed">{children}</dd>
    </div>
  );
}
