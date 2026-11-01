import { Badge, Card, EmptyState, fmtDate } from "@/components/ui";
import { SourceLink } from "@/components/evidence-list";
import type { TimelineEvent } from "@/db/schema";
import type { Workspace } from "@/lib/queries";
import { factMap, snapshotMap } from "@/lib/queries";
import { runLabel } from "@/components/overview";

export function Timeline({ ws }: { ws: Workspace }) {
  const facts = factMap(ws.facts);
  const snapshots = snapshotMap(ws.snapshots);
  if (ws.timeline.length === 0) return <EmptyState title="No timeline events yet">Run Delta to turn facts into a dated history of what the competitor did.</EmptyState>;

  // Chains: events whose facts come from captures of the same URL. The earliest event per URL is the chain root.
  const urlsOf = (e: TimelineEvent) => Array.from(new Set(e.factIds.map((id) => snapshots.get(facts.get(id)?.snapshotId ?? -1)?.url).filter((u): u is string => Boolean(u))));
  const rootByUrl = new Map<string, TimelineEvent>();
  for (const e of ws.timeline) for (const url of urlsOf(e)) if (!rootByUrl.has(url)) rootByUrl.set(url, e);

  return (
    <ol className="relative grid gap-4 border-l border-line pl-6">
      {ws.timeline.flatMap((e, i) => {
        const prevRunId = i > 0 ? ws.timeline[i - 1].runId : null;
        const sources = Array.from(new Set(e.factIds.map((id) => facts.get(id)?.snapshotId).filter((x): x is number => x !== undefined)));
        const roots = urlsOf(e)
          .map((u) => rootByUrl.get(u)!)
          .filter((r) => r.id !== e.id);
        const root = roots.length ? roots.reduce((a, b) => (a.eventDate < b.eventDate || (a.eventDate === b.eventDate && a.id < b.id) ? a : b)) : null;
        const hasChange = e.factIds.some((id) => facts.get(id)?.isChange);
        const items: React.ReactNode[] = [];
        if (e.runId !== prevRunId) {
          items.push(
            <li key={`run-${e.runId}-${e.id}`} className="relative -ml-6 flex items-center gap-3 pl-6" data-run-divider={e.runId}>
              <span className="absolute -left-px top-1/2 h-px w-4 bg-line" aria-hidden />
              <span className="text-xs font-semibold uppercase tracking-wide text-accent">Found in {runLabel(ws.runs, e.runId)}</span>
              <span className="h-px flex-1 bg-line" aria-hidden />
            </li>,
          );
        }
        items.push(
          <li key={e.id} id={`e-${e.id}`} className="relative">
            <span className="absolute -left-[31px] top-4 h-2.5 w-2.5 rounded-full border-2 border-bg bg-accent" aria-hidden />
            <Card>
              <div className="flex flex-wrap items-center gap-2">
                <time className="text-sm font-semibold tabular-nums" dateTime={e.eventDate}>
                  {fmtDate(e.eventDate)}
                </time>
                {hasChange && <Badge tone="warn">change detected</Badge>}
                <span className="ml-auto text-[11px] text-muted">E{e.id}</span>
              </div>
              <h3 className="mt-1 font-medium">{e.title}</h3>
              {root && (
                <p className="mt-0.5 text-xs text-muted" data-chain-root={root.id}>
                  <span aria-hidden>↳ </span>continues:{" "}
                  <a href={`#e-${root.id}`} className="text-accent hover:underline">
                    {root.title}
                  </a>
                </p>
              )}
              <p className="mt-1 text-sm leading-relaxed text-fg/90">{e.summary}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {sources.map((sid) => (
                  <SourceLink key={sid} snapshot={snapshots.get(sid)} />
                ))}
              </div>
              {(e.relatedEventIds.length > 0 || e.factIds.length > 0) && (
                <div className="mt-2 flex flex-wrap gap-3 text-xs">
                  {e.relatedEventIds.length > 0 && (
                    <span className="text-muted">
                      Related to{" "}
                      {e.relatedEventIds.map((rid, i) => (
                        <span key={rid}>
                          {i > 0 && ", "}
                          <a href={`#e-${rid}`} className="text-accent hover:underline">
                            {ws.timeline.find((x) => x.id === rid)?.title ?? `E${rid}`}
                          </a>
                        </span>
                      ))}
                    </span>
                  )}
                  {e.factIds.length > 0 && (
                    <a href={`/c/${ws.competitor.slug}?tab=evidence&facts=${e.factIds.join(",")}`} className="text-accent hover:underline">
                      {e.factIds.length} fact{e.factIds.length === 1 ? "" : "s"} →
                    </a>
                  )}
                </div>
              )}
            </Card>
          </li>,
        );
        return items;
      })}
    </ol>
  );
}
