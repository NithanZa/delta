import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, EmptyState, SectionTitle, cx, fmtDate } from "@/components/ui";
import { EvidenceList } from "@/components/evidence-list";
import { statusTone } from "@/components/overview";
import { linkRefs } from "@/components/refs";
import { getCompetitorWorkspace, getRunDetail, factMap, snapshotMap } from "@/lib/queries";

export default async function RunDetailPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const detail = getRunDetail(Number(id));
  const ws = getCompetitorWorkspace(slug);
  if (!detail || !ws || detail.competitor.slug !== slug) notFound();
  const { run } = detail;
  const facts = factMap(ws.facts);
  const snapshots = snapshotMap(ws.snapshots);
  const hyp = (hid: number) => detail.hypotheses.find((h) => h.id === hid);

  const stat = (label: string, value: string | number | undefined) => (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value ?? "—"}</dd>
    </div>
  );

  return (
    <div className="grid gap-6">
      <div>
        <Link href={`/c/${slug}`} className="text-xs text-muted hover:text-accent">
          ← {ws.competitor.name}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{run.label}</h1>
          <Badge tone={run.status === "done" ? "ok" : run.status === "failed" ? "bad" : "warn"}>{run.status}</Badge>
          <span className="text-sm text-muted">
            pages dated ≤ {fmtDate(run.cutoffDate)} · started {run.startedAt ? `${new Date(run.startedAt).toLocaleString("en-US", { timeZone: "UTC", hour12: false })} UTC` : "—"}
          </span>
        </div>
        {run.error && <p className="mt-2 rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{run.error}</p>}
      </div>

      <Card>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
          {stat("Pages", run.stats.snapshots)}
          {stat("Facts", run.stats.facts)}
          {stat("Changes", run.stats.changes)}
          {stat("Hypotheses updated", run.stats.hypothesesUpdated)}
          {stat("Insights", run.stats.insights)}
          {stat("Prompt tokens", run.stats.promptTokens?.toLocaleString())}
          {stat("Completion tokens", run.stats.completionTokens?.toLocaleString())}
          {stat("Wall time", run.stats.wallMs ? `${Math.round(run.stats.wallMs / 1000)}s` : undefined)}
        </dl>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="grid content-start gap-6">
          <SectionTitle>How conclusions changed in this run</SectionTitle>
          {detail.updates.length === 0 ? (
            <EmptyState title="No hypothesis updates" />
          ) : (
            <div className="grid gap-3">
              {detail.updates.map((u) => {
                const h = hyp(u.hypothesisId);
                return (
                  <Card key={u.id}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={statusTone[u.change]}>{u.change}</Badge>
                      <a href={`/c/${slug}?tab=overview#h-${u.hypothesisId}`} className="text-xs text-accent hover:underline">
                        H{u.hypothesisId}
                      </a>
                      <span className="text-xs tabular-nums text-muted">
                        {u.prevConfidence !== null ? `${Math.round(u.prevConfidence * 100)}% → ` : ""}
                        {Math.round(u.newConfidence * 100)}%
                      </span>
                    </div>
                    {h && <p className={cx("mt-1.5 text-sm", u.change === "retired" ? "text-muted line-through" : "font-medium")}>{h.statement}</p>}
                    <p className="mt-1.5 text-sm leading-relaxed text-fg/90">{linkRefs(u.reasoning, slug)}</p>
                    {u.factIds.length > 0 && (
                      <details className="mt-2">
                        <summary className="text-xs text-accent hover:underline">
                          {u.factIds.length} fact{u.factIds.length === 1 ? "" : "s"} cited — show quotes
                        </summary>
                        <div className="mt-2">
                          <EvidenceList factIds={u.factIds} facts={facts} snapshots={snapshots} compact />
                        </div>
                      </details>
                    )}
                  </Card>
                );
              })}
            </div>
          )}

          <SectionTitle>Timeline events added</SectionTitle>
          {detail.events.length === 0 ? (
            <p className="text-sm text-muted">None.</p>
          ) : (
            <ul className="grid gap-2">
              {detail.events.map((e) => (
                <li key={e.id} className="rounded-md border border-line bg-surface p-3 text-sm">
                  <span className="font-medium tabular-nums">{fmtDate(e.eventDate)}</span> · {e.title}
                </li>
              ))}
            </ul>
          )}

          <SectionTitle>Questions</SectionTitle>
          <ul className="grid gap-2 text-sm">
            {detail.questionsRaised.map((q) => (
              <li key={q.id} className="rounded-md border border-line bg-surface p-3">
                <Badge tone="warn">raised</Badge> <span className="ml-1">{q.question}</span>
              </li>
            ))}
            {detail.questionsResolved.map((q) => (
              <li key={q.id} className="rounded-md border border-line bg-surface p-3">
                <Badge tone="ok">resolved</Badge> <span className="ml-1">{q.question}</span>
                {q.resolution && <p className="mt-1 text-xs text-muted">{q.resolution}</p>}
              </li>
            ))}
            {detail.questionsRaised.length + detail.questionsResolved.length === 0 && <li className="text-muted">None.</li>}
          </ul>
        </div>

        <div className="grid content-start gap-6">
          <SectionTitle>Insights written</SectionTitle>
          {detail.insights.length === 0 ? (
            <p className="text-sm text-muted">None.</p>
          ) : (
            <ul className="grid gap-2">
              {detail.insights.map((i) => (
                <li key={i.id} className="rounded-md border border-line bg-surface p-3 text-sm">
                  <Badge tone={i.severity === "high" ? "bad" : i.severity === "medium" ? "warn" : "neutral"}>{i.severity}</Badge>{" "}
                  <a href={`/c/${slug}?tab=insights#i-${i.id}`} className="ml-1 hover:text-accent hover:underline">
                    {i.title}
                  </a>
                </li>
              ))}
            </ul>
          )}

          <SectionTitle>Pages analyzed ({detail.snapshots.length})</SectionTitle>
          <ul className="grid gap-1 text-sm">
            {detail.snapshots.map((s) => (
              <li key={s.id} className="text-muted">
                <a href={s.archiveUrl ?? s.url} target="_blank" rel="noreferrer" className="hover:text-accent hover:underline">
                  {s.title || s.url}
                </a>{" "}
                · {fmtDate(s.publishedAt)} · {detail.facts.filter((f) => f.snapshotId === s.id).length} facts
              </li>
            ))}
          </ul>

          <SectionTitle>Run log</SectionTitle>
          <div className="max-h-[32rem] overflow-y-auto rounded-md bg-bg p-3 font-mono text-xs leading-5">
            {run.log.map((l, idx) => (
              <div key={idx} className={cx(l.level === "warn" && "text-warn", l.level === "error" && "text-bad")}>
                <span className="text-muted">{l.ts.slice(11, 19)}</span> {l.message}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
