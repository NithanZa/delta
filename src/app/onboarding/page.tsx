import Link from "next/link";
import { getDb } from "@/db";
import { Card, SectionTitle, cx } from "@/components/ui";
import { getCompany, listCompetitors } from "@/lib/queries";
import { getSchedule, getSetting, nextCronRun } from "@/lib/settings";
import { DigestSettingsForm } from "../settings/digest-form";
import { ScheduleForm } from "../settings/schedule-form";
import { CompanyStep, CompetitorStep, JobButton } from "./forms";

export const dynamic = "force-dynamic";

const STEPS = [
  ["1", "Your company"],
  ["2", "Competitors"],
  ["3", "Delivery"],
] as const;

/** Three-step setup from two URLs: company profile, competitors, delivery. */
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const step = STEPS.some(([s]) => s === sp.step) ? sp.step! : "1";
  const company = getCompany();
  const competitors = listCompetitors();
  const db = getDb();
  const schedule = getSchedule(db);
  const fmt = (pattern: string) => {
    const d = nextCronRun(pattern, schedule.timezone);
    return d ? d.toLocaleString("en-GB", { timeZone: schedule.timezone, hour12: false }) : "invalid";
  };
  const digestValues = { to: getSetting(db, "digest.to"), from: getSetting(db, "digest.from"), baseUrl: getSetting(db, "app.baseUrl"), slackWebhookUrl: getSetting(db, "slack.webhookUrl"), opsEmail: getSetting(db, "ops.email") };

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Set up Delta</h1>
        <p className="mt-1 text-sm text-muted">Two URLs and a few answers. Everything drafted here stays editable in Settings.</p>
      </div>
      <nav className="flex gap-1 border-b border-line" aria-label="Onboarding steps">
        {STEPS.map(([s, label]) => (
          <Link key={s} href={`/onboarding?step=${s}`} aria-current={step === s ? "page" : undefined} className={cx("-mb-px border-b-2 px-3 py-2 text-sm", step === s ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}>
            {s}. {label}
          </Link>
        ))}
      </nav>

      {step === "1" && (
        <Card>
          <SectionTitle>Your company</SectionTitle>
          <CompanyStep initialUrl={sp.url} existing={company ? { name: company.name, website: company.website } : null} />
        </Card>
      )}

      {step === "2" && (
        <div className="grid gap-4">
          {competitors.length > 0 && (
            <Card>
              <SectionTitle>Already tracked</SectionTitle>
              <ul className="grid gap-1 text-sm">
                {competitors.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/c/${c.slug}`} className="font-medium hover:text-accent hover:underline">
                      {c.name}
                    </Link>
                    <span className="text-xs text-muted">{c.website.replace(/^https?:\/\//, "")}</span>
                    <span className="text-xs text-muted">· {c.snapshotCount} pages</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <SectionTitle>Add a competitor</SectionTitle>
            <CompetitorStep initialUrl={sp.url} hasCompany={Boolean(company)} />
          </Card>
        </div>
      )}

      {step === "3" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <SectionTitle>Who gets the digest</SectionTitle>
            <DigestSettingsForm values={digestValues} />
          </Card>
          <div className="grid content-start gap-4">
            <Card>
              <SectionTitle>Schedule</SectionTitle>
              <p className="mb-3 text-xs text-muted">
                Next crawl {fmt(schedule.crawlCron)} · next run {fmt(schedule.runCron)} · next digest {fmt(schedule.digestCron)} ({schedule.timezone}).
              </p>
              <ScheduleForm schedule={schedule} nextRuns={{ crawl: fmt(schedule.crawlCron), run: fmt(schedule.runCron), digest: fmt(schedule.digestCron), discovery: fmt(schedule.discoveryCron) }} />
            </Card>
            <Card>
              <SectionTitle>Fill the record now</SectionTitle>
              <div className="grid gap-3">
                <JobButton kind="crawl" label="Crawl the watchlists now" note="Fetches every watched page and feed." />
                <JobButton kind="discovery" label="Run discovery now" note="Off-domain search and absence checks (needs EXA_API_KEY for search)." />
                <JobButton kind="backfill" label="Backfill 24 months" note="Wayback captures at quarterly cutoffs (phase 10)." />
              </div>
              <p className="mt-4 text-sm">
                <Link href="/" className="text-accent underline">
                  Finish → home
                </Link>
              </p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
