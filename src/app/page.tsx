import Link from "next/link";
import { Badge, Card, EmptyState, LinkButton, SectionTitle, fmtDate } from "@/components/ui";
import { getCompany, listCompetitors } from "@/lib/queries";

export default function Home() {
  const company = getCompany();
  const competitors = listCompetitors();

  if (!company) {
    return (
      <EmptyState title="No company profile yet">
        <Link href="/onboarding" className="text-accent underline">Set up Delta from your website</Link> (two URLs and a few questions), or describe your company in <Link href="/settings" className="text-accent underline">Settings</Link>. (Developers: <code className="rounded bg-surface-2 px-1">npm run seed</code> loads the demo.)
      </EmptyState>
    );
  }

  const fields: [string, string][] = [
    ["Product", company.product],
    ["Target customers", company.targetCustomers],
    ["Positioning", company.positioning],
    ["Priorities", company.priorities],
    ["Constraints", company.constraints],
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <div>
        <SectionTitle right={<LinkButton href="/settings">Edit</LinkButton>}>Your company</SectionTitle>
        <Card>
          <h1 className="text-xl font-semibold">{company.name}</h1>
          {company.description && <p className="mt-1 text-sm text-muted">{company.description}</p>}
          <dl className="mt-4 grid gap-3">
            {fields
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{k}</dt>
                  <dd className="mt-0.5 text-sm leading-relaxed">{v}</dd>
                </div>
              ))}
          </dl>
        </Card>
      </div>

      <div>
        <SectionTitle>Competitors</SectionTitle>
        {competitors.length === 0 ? (
          <EmptyState title="No competitors yet">Add one in Settings.</EmptyState>
        ) : (
          <div className="grid gap-3">
            {competitors.map((c) => (
              <Link key={c.id} href={`/c/${c.slug}`} className="block rounded-lg border border-line bg-surface p-4 transition hover:border-accent/50">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{c.name}</h2>
                    <p className="mt-0.5 line-clamp-2 text-sm text-muted">{c.description}</p>
                  </div>
                  <Badge tone={c.runCount ? "accent" : "neutral"}>
                    {c.runCount} run{c.runCount === 1 ? "" : "s"}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  <span>{c.snapshotCount} snapshots</span>
                  <span>{c.insightCount} insights</span>
                  <span>
                    Last run:{" "}
                    {c.lastRun
                      ? c.lastRun.status === "running" || c.lastRun.status === "queued"
                        ? `${c.lastRun.label} · in progress`
                        : `${c.lastRun.label} · ${fmtDate(c.lastRun.finishedAt ?? c.lastRun.startedAt)}${c.lastRun.status === "failed" ? " · failed" : ""}`
                      : "never"}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
