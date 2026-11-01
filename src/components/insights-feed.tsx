import type { Insight } from "@/db/schema";
import { Badge, Card, EmptyState, cx, type BadgeTone } from "@/components/ui";
import { EvidenceList } from "@/components/evidence-list";
import { CorrectionForm } from "@/components/correction-form";
import { InsightStatusButtons } from "@/components/insight-status";
import { runLabel } from "@/components/overview";
import { linkRefs } from "@/components/refs";
import { correctInsight } from "@/app/c/[slug]/actions";
import type { Workspace } from "@/lib/queries";
import { factMap, snapshotMap } from "@/lib/queries";

const severityTone: Record<Insight["severity"], BadgeTone> = { high: "bad", medium: "warn", low: "neutral" };
const severityRank: Record<Insight["severity"], number> = { high: 0, medium: 1, low: 2 };

export function InsightsFeed({ ws, companyName }: { ws: Workspace; companyName: string }) {
  const facts = factMap(ws.facts);
  const snapshots = snapshotMap(ws.snapshots);
  if (ws.insights.length === 0) return <EmptyState title="No insights yet">Insights appear after a run: what happened, what it might mean, why it matters to {companyName}, and what to do next.</EmptyState>;

  const sorted = [...ws.insights].sort((a, b) => b.runId - a.runId || severityRank[a.severity] - severityRank[b.severity] || a.id - b.id);

  return (
    <div className="grid gap-4">
      {sorted.map((i) => (
        <Card key={i.id} id={`i-${i.id}`} className={cx(i.status === "dismissed" && "border-dashed bg-surface/60")}>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={severityTone[i.severity]}>{i.severity}</Badge>
            <Badge tone="accent">{runLabel(ws.runs, i.runId)}</Badge>
            {i.status !== "new" && <Badge>{i.status}</Badge>}
            {i.userCorrection && <Badge tone="accent">corrected by you</Badge>}
            <span className="ml-auto text-[11px] text-muted">I{i.id}</span>
          </div>
          <h3 id={`i-${i.id}-title`} className={cx("mt-2 text-lg font-semibold leading-snug", i.status === "dismissed" && "line-through")}>
            {i.title}
          </h3>

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
            <InsightStatusButtons slug={ws.competitor.slug} id={i.id} status={i.status} title={i.title} />
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
        </Card>
      ))}
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
