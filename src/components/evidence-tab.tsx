import type { Snapshot } from "@/db/schema";
import { Badge, Card, EmptyState, SectionTitle, domainOf, fmtDate } from "@/components/ui";
import { EvidenceList } from "@/components/evidence-list";
import { AddUrlForm } from "@/components/add-url-form";
import { WatchToggle } from "@/components/watch-toggle";
import { runLabel } from "@/components/overview";
import type { Workspace } from "@/lib/queries";
import { factMap, snapshotMap } from "@/lib/queries";

export function EvidenceTab({ ws, filterFactIds }: { ws: Workspace; filterFactIds: number[] | null }) {
  const facts = factMap(ws.facts);
  const snapshots = snapshotMap(ws.snapshots);
  const sourcesById = new Map(ws.sources.map((s) => [s.id, s]));

  if (filterFactIds) {
    const found = filterFactIds.filter((id) => facts.has(id));
    const missing = filterFactIds.filter((id) => !facts.has(id));
    return (
      <div className="grid gap-4">
        <div className="flex items-center justify-between">
          <SectionTitle>
            {found.length} selected fact{found.length === 1 ? "" : "s"}
          </SectionTitle>
          <a href={`/c/${ws.competitor.slug}?tab=evidence`} className="text-xs text-accent hover:underline">
            Show all pages →
          </a>
        </div>
        {missing.length > 0 && <p className="text-xs text-muted">Fact{missing.length === 1 ? "" : "s"} {missing.map((id) => `F${id}`).join(", ")} no longer exist (the analysis was reset).</p>}
        <EvidenceList factIds={found} facts={facts} snapshots={snapshots} />
      </div>
    );
  }

  // Internal notes (partner replies) are listed apart from public pages; absence checks have their own cards.
  const internal = ws.snapshots.filter((s) => s.sourceType === "internal");
  const isCheck = (s: Snapshot) => s.url.startsWith("check://");
  // Group public snapshots by the run that processed them; unprocessed ones are pending.
  const groups = new Map<number | null, Snapshot[]>();
  for (const s of ws.snapshots.filter((x) => x.sourceType !== "internal" && !isCheck(x))) groups.set(s.processedRunId, [...(groups.get(s.processedRunId) ?? []), s]);
  const providerTone: Record<string, "neutral" | "accent" | "info" | "warn" | "ok"> = { seeded: "neutral", manual_url: "accent", watchlist: "ok", feed: "ok", discovery: "info", backfill: "warn", internal: "info", search: "info" };
  const runOrder = [...ws.runs].sort((a, b) => a.id - b.id).map((r) => r.id);
  const orderedKeys: (number | null)[] = [...runOrder.filter((id) => groups.has(id)), ...(groups.has(null) ? [null] : [])];

  return (
    <div className="grid gap-6">
      <Card>
        <h3 className="font-semibold">Add a page</h3>
        <p className="mt-1 text-sm text-muted">
          Paste any public URL about {ws.competitor.name}. It goes through the same fetch → extract → snapshot pipeline as the seeded pages and is analyzed in the next run.
        </p>
        <div className="mt-3">
          <AddUrlForm competitorId={ws.competitor.id} slug={ws.competitor.slug} />
        </div>
      </Card>

      {ws.snapshots.length === 0 && <EmptyState title="No pages yet">Add a URL above to start.</EmptyState>}

      {ws.absenceChecks.length > 0 && (
        <div>
          <SectionTitle>Absence checks ({ws.absenceChecks.length}) — what Delta looked for and did not find</SectionTitle>
          <div className="grid gap-2">
            {ws.absenceChecks.map((c) => (
              <Card key={c.id} className={c.result === "superseded" ? "border-dashed bg-surface/60" : undefined}>
                <div className="flex flex-wrap items-center gap-1.5 text-sm">
                  <Badge tone={c.result === "found" ? "ok" : c.result === "not_found" ? "warn" : "neutral"}>{c.result.replace("_", " ")}</Badge>
                  <span className="font-medium">checked for {c.topic.replace(/_/g, " ")}</span>
                  <span className="text-xs text-muted">· {fmtDate(c.checkedAt)}</span>
                  <span className="text-xs text-muted">
                    · {c.urlsChecked.length} URL{c.urlsChecked.length === 1 ? "" : "s"}, {c.queries.length} search{c.queries.length === 1 ? "" : "es"}
                  </span>
                  {c.snapshotId && (
                    <a href={`#s-${c.snapshotId}`} className="text-xs text-accent hover:underline">
                      S{c.snapshotId}
                    </a>
                  )}
                  {c.factId && (
                    <a href={`/c/${ws.competitor.slug}?tab=evidence&facts=${c.factId}`} className="text-xs text-accent hover:underline">
                      F{c.factId}
                    </a>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {internal.length > 0 && (
        <div>
          <SectionTitle>Internal notes ({internal.length}) — what your team told Delta</SectionTitle>
          <div className="grid gap-3">
            {internal.map((s) => {
              const sFacts = ws.facts.filter((f) => f.snapshotId === s.id);
              return (
                <Card key={s.id} id={`s-${s.id}`} className="border-info/40">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="info">internal</Badge>
                    {s.processedRunId === null && <Badge tone="warn">pending</Badge>}
                    <span className="text-xs text-muted">received {fmtDate(s.publishedAt)}</span>
                    <span className="ml-auto text-[11px] text-muted">S{s.id}</span>
                  </div>
                  <h3 className="mt-1.5 font-medium">{s.title}</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-fg/90">{s.extractedText.slice(0, 1200)}</p>
                  {sFacts.length > 0 && (
                    <details className="mt-2">
                      <summary className="text-xs text-accent hover:underline">{sFacts.length} claim{sFacts.length === 1 ? "" : "s"} recorded</summary>
                      <div className="mt-2">
                        <EvidenceList factIds={sFacts.map((f) => f.id)} facts={facts} snapshots={snapshots} compact />
                      </div>
                    </details>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {orderedKeys.map((key) => {
        const list = groups.get(key)!;
        return (
          <div key={key ?? "pending"}>
            <SectionTitle>{key === null ? `Not yet analyzed (${list.length}) — picked up by the next run` : `Pages analyzed in ${runLabel(ws.runs, key)} (${list.length})`}</SectionTitle>
            <div className="grid gap-3">
              {list.map((s) => {
                const sFacts = ws.facts.filter((f) => f.snapshotId === s.id);
                return (
                  <Card key={s.id} id={`s-${s.id}`}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge>{s.sourceType.replace("_", " ")}</Badge>
                      {sourcesById.get(s.sourceId) && sourcesById.get(s.sourceId)!.provider !== "seeded" && (
                        <Badge tone={providerTone[sourcesById.get(s.sourceId)!.provider] ?? "neutral"}>{sourcesById.get(s.sourceId)!.provider.replace("_", " ")}</Badge>
                      )}
                      {s.archiveUrl && <Badge tone="info">Wayback capture</Badge>}
                      {sourcesById.get(s.sourceId)?.watch && <Badge tone="accent">watched</Badge>}
                      {key === null && <Badge tone="warn">pending</Badge>}
                      <span className="text-xs text-muted">published/captured {fmtDate(s.publishedAt)}</span>
                      <span className="text-xs text-muted">· fetched {fmtDate(s.fetchedAt)}</span>
                      <span className="ml-auto text-[11px] text-muted">S{s.id}</span>
                    </div>
                    <h3 className="mt-1.5 font-medium">
                      <a href={s.archiveUrl ?? s.url} target="_blank" rel="noreferrer" className="hover:text-accent hover:underline">
                        {s.title || s.url}
                      </a>
                    </h3>
                    {(sourcesById.get(s.sourceId)?.relevanceNote || sourcesById.get(s.sourceId)?.discoveryQuery) && (
                      <p className="mt-1 text-xs text-muted">
                        {sourcesById.get(s.sourceId)?.relevanceNote && <>Why it was kept: {sourcesById.get(s.sourceId)!.relevanceNote} </>}
                        {sourcesById.get(s.sourceId)?.discoveryQuery && <span className="font-mono">({sourcesById.get(s.sourceId)!.discoveryQuery})</span>}
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-3">
                      <WatchToggle slug={ws.competitor.slug} sourceId={s.sourceId} watch={Boolean(sourcesById.get(s.sourceId)?.watch)} />
                    </div>
                    <p className="text-xs text-muted">
                      {domainOf(s.url)} · {s.extractedText.length.toLocaleString()} chars extracted
                      {s.archiveUrl && (
                        <>
                          {" "}
                          ·{" "}
                          <a href={s.url} target="_blank" rel="noreferrer" className="hover:text-accent hover:underline">
                            live URL
                          </a>
                        </>
                      )}
                    </p>
                    {sFacts.length > 0 ? (
                      <details className="mt-2">
                        <summary className="text-xs text-accent hover:underline">
                          {sFacts.length} fact{sFacts.length === 1 ? "" : "s"} extracted
                          {sFacts.some((f) => f.isChange) && ` · ${sFacts.filter((f) => f.isChange).length} change${sFacts.filter((f) => f.isChange).length === 1 ? "" : "s"} vs the previous capture`}
                        </summary>
                        <div className="mt-2">
                          <EvidenceList
                            factIds={sFacts.map((f) => f.id)}
                            facts={facts}
                            snapshots={snapshots}
                            compact
                          />
                        </div>
                      </details>
                    ) : (
                      <p className="mt-2 text-xs text-muted">{key === null ? "Waiting for the next run." : "No facts were extracted from this page."}</p>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
