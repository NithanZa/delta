import Link from "next/link";
import { getDb } from "@/db";
import { Badge, EmptyState, SectionTitle, fmtDate, type BadgeTone } from "@/components/ui";
import { listDigests } from "@/lib/digest/job";

export const dynamic = "force-dynamic";

const tone: Record<string, BadgeTone> = { draft: "neutral", held: "warn", sent: "ok", failed: "bad" };

export default function DigestsPage() {
  const digests = listDigests(getDb());
  return (
    <div className="grid gap-4">
      <SectionTitle>Digests</SectionTitle>
      {digests.length === 0 ? (
        <EmptyState title="No digests yet">
          The worker sends one on the digest schedule; <code className="rounded bg-surface-2 px-1">npm run digest -- --preview</code> renders one without sending.
        </EmptyState>
      ) : (
        <ul className="grid gap-2">
          {digests.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm">
              <span className="font-mono text-xs text-muted">#{d.id}</span>
              <Badge tone={tone[d.status] ?? "neutral"}>{d.status}</Badge>
              <Badge>{d.channel}</Badge>
              <span className="text-xs text-muted">sequence {d.sequence}</span>
              <Link href={`/digests/${d.id}`} className="font-medium hover:text-accent hover:underline">
                {d.subject || "(untitled)"}
              </Link>
              <span className="text-xs text-muted">
                {fmtDate(d.periodStart)} – {fmtDate(d.periodEnd)} · to {d.recipients.join(", ") || "nobody"}
                {d.sentAt && ` · sent ${fmtDate(d.sentAt)}`}
              </span>
              {d.error && <span className="truncate text-xs text-bad">{d.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
