import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { getDb } from "@/db";
import { recordEvent } from "@/lib/events";
import { cx, fmtDate } from "@/components/ui";
import { EvidenceTab } from "@/components/evidence-tab";
import { InsightsFeed } from "@/components/insights-feed";
import { Overview } from "@/components/overview";
import { QuestionsTab } from "@/components/questions-tab";
import { BackfillPanel } from "@/components/backfill-panel";
import { RunPanel } from "@/components/run-panel";
import { Timeline } from "@/components/timeline";
import { getModelLabels } from "@/lib/llm/config";
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
  // Arrivals through a digest or Slack link count as "viewed" (the funnel's second step).
  if (sp.via) {
    const via = sp.via;
    const competitorId = ws.competitor.id;
    after(() => recordEvent(getDb(), "insight_viewed", { competitorId, tab, via }));
  }
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
        {ws.backfilledRange ? (
          <p className="max-w-md rounded-md border border-info/40 px-3 py-1.5 text-xs leading-5 text-info">
            History backfilled from Wayback captures between {fmtDate(ws.backfilledRange.from)} and {fmtDate(ws.backfilledRange.to)}. Each run only sees pages dated on or before its cutoff.
          </p>
        ) : (
          ws.capturedRange && (
            <p className="max-w-md rounded-md border border-info/40 px-3 py-1.5 text-xs leading-5 text-info">
              Replaying {ws.snapshots.length} archived pages published {fmtDate(ws.capturedRange.from)}
              {ws.capturedRange.from !== ws.capturedRange.to && ` – ${fmtDate(ws.capturedRange.to)}`}. Each run only sees pages dated on or before its cutoff.
            </p>
          )
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
        models={getModelLabels()}
      />

      <BackfillPanel competitorId={ws.competitor.id} slug={slug} activeJobId={ws.activeBackfillJobId} hasWatchlist={ws.sources.some((s) => s.watch && s.enabled)} />

      <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label="Competitor sections">
        {TABS.map(([key, label]) => (
          <Link
            key={key}
            href={`/c/${slug}?tab=${key}`}
            aria-current={tab === key ? "page" : undefined}
            className={cx(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition",
              tab === key ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {label}
            {counts[key] > 0 && (
              <span className="ml-1.5 text-xs text-muted">
                <span className="sr-only"> (</span>
                {counts[key]}
                <span className="sr-only">)</span>
              </span>
            )}
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
