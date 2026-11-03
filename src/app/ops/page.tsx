import Link from "next/link";
import { getDb } from "@/db";
import { Badge, Card, SectionTitle, cx, type BadgeTone } from "@/components/ui";
import { listJobs } from "@/lib/jobs/queue";
import { listCompetitors } from "@/lib/queries";
import { getSchedule, getSetting, nextCronRun } from "@/lib/settings";
import { EnqueueButton } from "./enqueue-button";
import { SendAnywayForm } from "./send-anyway";
import { heldDigests } from "@/lib/digest/job";
import { countEvents, funnelByWeek, listEvents } from "@/lib/events";
import { DecisionForm } from "./decision-form";
import { schema } from "@/db";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const WORKER_STALE_MS = 3 * 60 * 1000;

const statusTone: Record<string, BadgeTone> = { queued: "neutral", running: "accent", done: "ok", failed: "bad", skipped: "info" };

function duration(start: string | null, end: string | null): string {
  if (!start) return "—";
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  return ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`;
}

/** Worker heartbeat age, read outside the component so the render stays pure. */
function workerStatus(heartbeat: string | null, now = Date.now()) {
  const heartbeatAge = heartbeat ? now - new Date(heartbeat).getTime() : null;
  return { heartbeatAge, workerOk: heartbeatAge !== null && heartbeatAge < WORKER_STALE_MS };
}

/** Operations: worker health, the schedule, the job queue and "run now" buttons. */
export default function OpsPage() {
  const db = getDb();
  const heartbeat = getSetting(db, "worker.heartbeatAt");
  const { heartbeatAge, workerOk } = workerStatus(heartbeat);
  const schedule = getSchedule(db);
  const fmt = (d: Date | null) => (d ? d.toLocaleString("en-GB", { timeZone: schedule.timezone, hour12: false }) : "invalid pattern");
  const nextTimes = [
    ["Crawl", schedule.crawlCron],
    ["Run", schedule.runCron],
    ["Digest", schedule.digestCron],
    ["Discovery", schedule.discoveryCron],
    ["Backup", "0 2 * * *"],
  ].map(([name, pattern]) => ({ name, pattern, next: fmt(nextCronRun(pattern, schedule.timezone)) }));
  const jobs = listJobs(db, 50);
  const held = heldDigests(db);
  const funnel = countEvents(db);
  const weeks = funnelByWeek(db);
  const decisions = listEvents(db, "decision_influenced", 20);
  const answers = db.select().from(schema.inboundMessages).where(eq(schema.inboundMessages.status, "processed")).orderBy(desc(schema.inboundMessages.id)).limit(20).all();
  const competitors = listCompetitors();
  const competitorName = (id: number | null) => (id === null ? "all competitors" : (competitors.find((c) => c.id === id)?.name ?? `competitor ${id}`));

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Operations</h1>
        <div className="flex gap-4">
          <Link href="/usage" className="text-xs text-accent hover:underline">
            API spend →
          </Link>
          <Link href="/settings" className="text-xs text-accent hover:underline">
            Edit the schedule in Settings →
          </Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>Worker</SectionTitle>
          <div className="flex items-center gap-2">
            <span className={cx("inline-block h-2.5 w-2.5 rounded-full", workerOk ? "bg-ok" : "bg-bad")} aria-hidden />
            <span className="text-sm">
              {workerOk
                ? `Alive · heartbeat ${Math.round(heartbeatAge! / 1000)}s ago`
                : heartbeat
                  ? `No heartbeat for ${Math.round(heartbeatAge! / 60_000)} min — is npm run worker running?`
                  : "Not running — start it with npm run worker"}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted">Timezone {schedule.timezone}. The worker runs one job at a time and polls the queue every 20 s.</p>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {nextTimes.map((t) => (
                <tr key={t.name} className="border-t border-line">
                  <td className="py-1.5 pr-3 font-medium">{t.name}</td>
                  <td className="py-1.5 pr-3 font-mono text-xs text-muted">{t.pattern}</td>
                  <td className="py-1.5 text-xs text-muted">next {t.next}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card>
          <SectionTitle>Run now</SectionTitle>
          <div className="grid gap-3">
            {competitors.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2">
                <span className="w-32 truncate text-sm font-medium">{c.name}</span>
                <EnqueueButton kind="crawl" competitorId={c.id} label="Crawl now" />
                <EnqueueButton kind="run" competitorId={c.id} label="Run now" />
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <span className="w-32 text-sm font-medium">Everything</span>
              <EnqueueButton kind="crawl" label="Crawl all" />
              <EnqueueButton kind="digest" label="Digest now" />
              <EnqueueButton kind="backup" label="Backup now" />
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>Held and failed digests</SectionTitle>
          {held.length === 0 ? (
            <p className="text-sm text-muted">None. Digests are held when a cited quote is not verbatim, a fact postdates its run, or two insight titles duplicate each other.</p>
          ) : (
            <ul className="grid gap-3">
              {held.map((d) => (
                <li key={d.id} className="rounded-md border border-line p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted">#{d.id}</span>
                    <Badge tone={d.status === "held" ? "warn" : "bad"}>{d.status}</Badge>
                    <Link href={`/digests/${d.id}`} className="font-medium hover:text-accent hover:underline">
                      {d.subject}
                    </Link>
                  </div>
                  <p className="mt-1 text-xs text-bad">{d.error}</p>
                  <div className="mt-2">
                    <SendAnywayForm digestId={d.id} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <SectionTitle>Funnel</SectionTitle>
          <table className="w-full text-sm">
            <tbody>
              {(
                [
                  ["Digests sent", funnel.digest_sent],
                  ["Insights viewed via a link", funnel.insight_viewed],
                  ["Reactions (useful / wrong / acted on)", funnel.insight_reacted],
                  ["Corrections", funnel.insight_corrected],
                  ["Sources added", funnel.source_added],
                  ["Replies received", funnel.reply_received],
                  ["Decisions influenced", funnel.decision_influenced],
                ] as const
              ).map(([label, n]) => (
                <tr key={label} className="border-t border-line">
                  <td className="py-1.5 pr-3">{label}</td>
                  <td className="py-1.5 text-right font-semibold tabular-nums">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>Partner answers</SectionTitle>
          {answers.length === 0 ? (
            <p className="text-sm text-muted">No notes yet. Notes sent from the link in the digest appear here, including answers to the question in every fourth digest.</p>
          ) : (
            <ul className="grid gap-3">
              {answers.map((a) => (
                <li key={a.id} className="rounded-md border border-line p-3 text-sm">
                  <p className="text-xs text-muted">
                    {a.fromEmail} · {a.receivedAt.slice(0, 10)}
                    {a.digestId ? ` · digest #${a.digestId}` : ""}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{(a.text ?? "").slice(0, 1200) || "(no text)"}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <SectionTitle>Decisions influenced</SectionTitle>
          <DecisionForm />
          {decisions.length > 0 && (
            <ul className="mt-3 grid gap-2 border-t border-line pt-3 text-sm">
              {decisions.map((d) => (
                <li key={d.id}>
                  <span className="text-xs text-muted">
                    {String(d.props.date ?? d.createdAt.slice(0, 10))}
                    {d.props.insightId ? ` · I${String(d.props.insightId)}` : ""}
                  </span>
                  <p>{String(d.props.text ?? "")}</p>
                </li>
              ))}
            </ul>
          )}
          <h3 className="mt-4 mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Funnel by week</h3>
          {weeks.length === 0 ? (
            <p className="text-sm text-muted">No events yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1 font-medium">Week of</th>
                  <th className="py-1 text-right font-medium">Sent</th>
                  <th className="py-1 text-right font-medium">Reacted</th>
                  <th className="py-1 text-right font-medium">Replied</th>
                  <th className="py-1 text-right font-medium">Decided</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => (
                  <tr key={w.week} className="border-t border-line tabular-nums">
                    <td className="py-1">{w.week}</td>
                    <td className="py-1 text-right">{w.sent}</td>
                    <td className="py-1 text-right">{w.reacted}</td>
                    <td className="py-1 text-right">{w.replied}</td>
                    <td className="py-1 text-right font-semibold">{w.decided}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div>
        <SectionTitle>Jobs (last {jobs.length})</SectionTitle>
        {jobs.length === 0 ? (
          <p className="text-sm text-muted">No jobs yet.</p>
        ) : (
          <div className="grid gap-2">
            {jobs.map((j) => (
              <details key={j.id} id={`job-${j.id}`} className="rounded-md border border-line bg-surface">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <span className="font-mono text-xs text-muted">#{j.id}</span>
                  <span className="font-medium">{j.kind}</span>
                  <span className="text-muted">{competitorName(j.competitorId)}</span>
                  <Badge tone={statusTone[j.status] ?? "neutral"}>{j.status}</Badge>
                  <span className="text-xs text-muted">by {j.requestedBy}</span>
                  <span className="text-xs text-muted">· {j.createdAt.replace("T", " ").slice(0, 16)}</span>
                  <span className="text-xs text-muted">· {duration(j.startedAt, j.finishedAt)}</span>
                  {j.error && <span className="truncate text-xs text-bad">{j.error}</span>}
                </summary>
                <div className="max-h-72 overflow-y-auto border-t border-line bg-bg p-3 font-mono text-xs leading-5">
                  {j.log.length === 0 && <span className="text-muted">(no log lines)</span>}
                  {j.log.map((l, i) => (
                    <div key={i} className={cx(l.level === "warn" && "text-warn", l.level === "error" && "text-bad")}>
                      <span className="text-muted">{l.ts.slice(11, 19)}</span> {l.message}
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
