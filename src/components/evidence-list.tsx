import type { Fact, Snapshot } from "@/db/schema";
import { Badge, cx, domainOf, fmtDate, type BadgeTone } from "@/components/ui";

export function SourceLink({ snapshot, className }: { snapshot: Snapshot | undefined; className?: string }) {
  if (!snapshot) return <span className="text-xs text-muted">unknown source</span>;
  const href = snapshot.archiveUrl ?? snapshot.url;
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cx("text-xs text-muted hover:text-accent hover:underline", className)} title={snapshot.url}>
      {snapshot.title || snapshot.url} · {domainOf(snapshot.url)} · {fmtDate(snapshot.publishedAt)}
      {snapshot.archiveUrl && " · archived"}
    </a>
  );
}

const cadenceLabel: Record<string, string> = { monthly: "monthly", annual: "annual", one_time: "one-time", unknown: "cadence unknown" };
const availabilityLabel: Record<string, { label: string; tone: BadgeTone }> = {
  announced: { label: "announced", tone: "info" },
  coming_soon: { label: "coming soon", tone: "info" },
  beta: { label: "beta", tone: "info" },
  deprecated: { label: "deprecated", tone: "warn" },
  unknown: { label: "availability unknown", tone: "neutral" },
};

/** Cadence, availability, absence-check and attribution badges for one fact. */
export function FactBadges({ fact }: { fact: Fact }) {
  const availability = fact.availability && fact.availability !== "shipped" ? availabilityLabel[fact.availability] : null;
  return (
    <>
      {fact.billingCadence && <Badge tone={fact.billingCadence === "unknown" ? "neutral" : "accent"}>{cadenceLabel[fact.billingCadence] ?? fact.billingCadence}</Badge>}
      {availability && <Badge tone={availability.tone}>{availability.label}</Badge>}
      {fact.claimKind === "absence" && <Badge tone="warn">absence check</Badge>}
      {fact.attribution !== "public" && <Badge tone="info">{fact.attribution}</Badge>}
    </>
  );
}

export function EvidenceList({
  factIds,
  facts,
  snapshots,
  compact = false,
}: {
  factIds: number[];
  facts: Map<number, Fact>;
  snapshots: Map<number, Snapshot>;
  compact?: boolean;
}) {
  const rows = factIds.map((id) => facts.get(id)).filter((f): f is Fact => Boolean(f));
  if (rows.length === 0) return <p className="text-xs text-muted">No linked evidence.</p>;
  return (
    <ul className={cx("grid gap-3", compact && "gap-2")}>
      {rows.map((f) => (
        <li key={f.id} id={`f-${f.id}`} className={cx("rounded-md border border-line bg-bg p-3", compact && "p-2")}>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge>{f.category}</Badge>
            {f.isChange && <Badge tone="warn">changed since previous snapshot</Badge>}
            <FactBadges fact={f} />
            <span className="text-xs text-muted">{fmtDate(f.eventDate)}</span>
            <span className="text-xs text-muted">· importance {f.importance}/5</span>
            <span className="ml-auto text-[11px] text-muted">F{f.id}</span>
          </div>
          <p className="mt-1.5 text-sm">{f.statement}</p>
          {f.claimKind === "absence" ? (
            <p className="mt-1.5 text-xs text-muted">Check performed: {f.quote}</p>
          ) : (
            <blockquote className="mt-1.5 text-xs italic">“{f.quote}”</blockquote>
          )}
          <div className="mt-1.5">
            <SourceLink snapshot={snapshots.get(f.snapshotId)} />
          </div>
        </li>
      ))}
    </ul>
  );
}
