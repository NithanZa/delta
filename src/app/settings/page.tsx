import Link from "next/link";
import { Card, SectionTitle } from "@/components/ui";
import { getCompany, listCompetitors, listFeeds, listQuestions, listWatchlist } from "@/lib/queries";
import { AddCompetitorForm, CompanyForm, CompetitorDetailsForm, QuestionsForm } from "./forms";
import { WatchlistSection } from "./watchlist-forms";
import { ScheduleForm } from "./schedule-form";
import { DigestSettingsForm } from "./digest-form";
import { DiscoverySettingsForm } from "./discovery-form";
import { getDb } from "@/db";
import { getSchedule, getSetting, nextCronRun } from "@/lib/settings";

export default function SettingsPage() {
  const company = getCompany();
  const competitors = listCompetitors().map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    website: c.website,
    description: c.description,
    questions: listQuestions(c.id).map((q) => q.text),
    sources: listWatchlist(c.id),
    feeds: listFeeds(c.id),
  }));

  const db = getDb();
  const schedule = getSchedule(db);
  const discoveryValues = {
    enabled: getSetting(db, "discovery.enabled"),
    maxNewPagesPerRun: getSetting(db, "discovery.maxNewPagesPerRun"),
    lookbackDays: getSetting(db, "discovery.lookbackDays"),
    blockedDomains: getSetting(db, "discovery.blockedDomains"),
  };
  const digestValues = {
    to: getSetting(db, "digest.to"),
    from: getSetting(db, "digest.from"),
    baseUrl: getSetting(db, "app.baseUrl"),
    slackWebhookUrl: getSetting(db, "slack.webhookUrl"),
    opsEmail: getSetting(db, "ops.email"),
  };
  const fmt = (pattern: string) => {
    const d = nextCronRun(pattern, schedule.timezone);
    return d ? d.toLocaleString("en-GB", { timeZone: schedule.timezone, hour12: false }) : "invalid";
  };
  const nextRuns = { crawl: fmt(schedule.crawlCron), run: fmt(schedule.runCron), digest: fmt(schedule.digestCron), discovery: fmt(schedule.discoveryCron) };

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="grid content-start gap-8">
        <div>
          <SectionTitle>Company profile</SectionTitle>
          <Card>
            <p className="mb-4 text-sm text-muted">
              Delta uses this to decide which competitor moves matter and which responses are realistic.{" "}
              <Link href={`/onboarding?step=1${company?.website ? `&url=${encodeURIComponent(company.website)}` : ""}`} className="text-accent underline">
                Re-draft from website →
              </Link>
            </p>
            <CompanyForm company={company} />
          </Card>
        </div>
        <div>
          <SectionTitle>Schedule</SectionTitle>
          <Card>
            <p className="mb-4 text-sm text-muted">
              Cron patterns (5 fields: minute hour day-of-month month day-of-week) in the timezone below. The worker (<code className="rounded bg-surface-2 px-1">npm run worker</code>) crawls, runs and sends on these; <Link href="/ops" className="text-accent underline">/ops</Link> shows what it is doing.
            </p>
            <ScheduleForm schedule={schedule} nextRuns={nextRuns} />
          </Card>
        </div>
        <div>
          <SectionTitle>Discovery</SectionTitle>
          <Card>
            <p className="mb-4 text-sm text-muted">
              Off-domain search (news, press, reviews, partner pages) through Exa, plus monthly absence checks. Needs <code className="rounded bg-surface-2 px-1">EXA_API_KEY</code>; absence checks probe the competitor&apos;s own paths without it.
            </p>
            <DiscoverySettingsForm values={discoveryValues} />
          </Card>
        </div>
        <div>
          <SectionTitle>Digest</SectionTitle>
          <Card>
            <p className="mb-4 text-sm text-muted">
              The weekly email. Sending needs <code className="rounded bg-surface-2 px-1">RESEND_API_KEY</code> and a verified domain. Preview any time with <code className="rounded bg-surface-2 px-1">npm run digest -- --preview</code>.
            </p>
            <DigestSettingsForm values={digestValues} />
          </Card>
        </div>
        <div>
          <SectionTitle>Add competitor</SectionTitle>
          <Card>
            <p className="mb-4 text-sm text-muted">
              Creates an empty workspace at <code className="rounded bg-surface-2 px-1">/c/&lt;slug&gt;</code>. Add pages from its Evidence tab, then start a run. Or{" "}
              <Link href="/onboarding?step=2" className="text-accent underline">
                add a competitor from its URL →
              </Link>
            </p>
            <AddCompetitorForm />
          </Card>
        </div>
      </div>
      <div>
        <SectionTitle>Competitors</SectionTitle>
        <div className="grid gap-4">
          {competitors.length === 0 && <p className="text-sm text-muted">No competitors yet. Add one on the left.</p>}
          {competitors.map((c) => (
            <Card key={c.id}>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 className="font-semibold">{c.name}</h2>
                <Link href={`/c/${c.slug}`} className="text-xs text-accent underline">
                  /c/{c.slug}
                </Link>
              </div>
              <CompetitorDetailsForm competitorId={c.id} website={c.website} description={c.description} />
              {c.website && (
                <p className="mt-2 text-xs">
                  <Link href={`/onboarding?step=2&url=${encodeURIComponent(c.website)}`} className="text-accent underline">
                    Re-draft from website →
                  </Link>
                </p>
              )}
              <h3 className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Research questions</h3>
              <QuestionsForm competitorId={c.id} questions={c.questions} />
              <h3 className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Crawler</h3>
              <p className="mb-3 text-xs text-muted">
                Watched pages are re-fetched on their interval and feeds are polled for new posts by <code className="rounded bg-surface-2 px-1">npm run crawl</code> (and the scheduler, once it exists). A new snapshot is stored only when the page text changed.
              </p>
              <WatchlistSection competitorId={c.id} website={c.website} sources={c.sources} feeds={c.feeds} />
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
