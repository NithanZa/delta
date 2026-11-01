import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, cx, fmtDate } from "@/components/ui";
import { EvidenceTab } from "@/components/evidence-tab";
import { InsightsFeed } from "@/components/insights-feed";
import { Overview } from "@/components/overview";
import { QuestionsTab } from "@/components/questions-tab";
import { RunPanel } from "@/components/run-panel";
import { Timeline } from "@/components/timeline";
import { getCompany, getCompetitorWorkspace } from "@/lib/queries";

const TABS = [
  ["overview", "Overview"],
  ["timeline", "Timeline"],
  ["insights", "Insights"],
  ["evidence", "Evidence"],
  ["questions", "Questions"],
] as const;
type Tab = (typeof TABS)[number][0];

export default async function CompetitorPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ws = getCompetitorWorkspace(slug);
  if (!ws) notFound();
  const company = getCompany();
  const tab: Tab = (TABS.find(([k]) => k === sp.tab)?.[0] ?? "overview") as Tab;
  const filterFactIds = sp.facts
    ? sp.facts
        .split(",")
        .map((x) => Number(x))
        .filter((n) => Number.isInteger(n) && n > 0)
    : null;

  const counts: Record<Tab, number> = {
    overview: ws.hypotheses.filter((h) => h.status !== "retired").length,
    timeline: ws.timeline.length,
    insights: ws.insights.length,
    evidence: ws.snapshots.length,
    questions: ws.questions_open.length,
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{ws.competitor.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {ws.competitor.website && (
              <a href={ws.competitor.website} target="_blank" rel="noreferrer" className="hover:text-accent hover:underline">
                {ws.competitor.website.replace(/^https?:\/\//, "")}
              </a>
            )}
            {ws.competitor.description && <> · {ws.competitor.description}</>}
          </p>
        </div>
        {ws.capturedRange && (
          <Badge tone="info" className="py-1">
            Replaying {ws.snapshots.length} snapshots captured {fmtDate(ws.capturedRange.from)}
            {ws.capturedRange.from !== ws.capturedRange.to && ` – ${fmtDate(ws.capturedRange.to)}`} · each run only sees pages dated on or before its cutoff
          </Badge>
        )}
      </div>

      <RunPanel
        slug={slug}
        competitorId={ws.competitor.id}
        nextRun={ws.nextRun}
        runs={ws.runs}
        isRunning={ws.isRunning}
        pendingSnapshots={ws.pendingSnapshots}
        openQuestions={ws.questions_open.length}
      />

      <nav className="flex gap-1 border-b border-line" role="tablist">
        {TABS.map(([key, label]) => (
          <Link
            key={key}
            href={`/c/${slug}?tab=${key}`}
            role="tab"
            aria-selected={tab === key}
            className={cx(
              "-mb-px border-b-2 px-3 py-2 text-sm transition",
              tab === key ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {label}
            {counts[key] > 0 && <span className="ml-1.5 text-xs text-muted">{counts[key]}</span>}
          </Link>
        ))}
      </nav>

      {tab === "overview" && <Overview ws={ws} />}
      {tab === "timeline" && <Timeline ws={ws} />}
      {tab === "insights" && <InsightsFeed ws={ws} companyName={company?.name ?? "your company"} />}
      {tab === "evidence" && <EvidenceTab ws={ws} filterFactIds={filterFactIds} />}
      {tab === "questions" && <QuestionsTab ws={ws} />}
    </div>
  );
}
