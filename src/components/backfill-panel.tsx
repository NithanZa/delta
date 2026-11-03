"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { Job } from "@/db/schema";
import { Button, Spinner } from "@/components/ui";
import { enqueueBackfill } from "@/app/c/[slug]/actions";

type Progress = { stage: string; cutoffsDone: number; cutoffsTotal: number; pagesFetched: number; currentCutoff: string | null; runsFailed: number };

/** "Backfill history" button plus a progress panel polling the job while it runs. */
export function BackfillPanel({ competitorId, slug, activeJobId, hasWatchlist }: { competitorId: number; slug: string; activeJobId: number | null; hasWatchlist: boolean }) {
  const router = useRouter();
  const [jobId, setJobId] = useState<number | null>(activeJobId);
  const [job, setJob] = useState<Job | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const tick = async () => {
      const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as Job;
      if (stop) return;
      setJob(j);
      if (j.status === "done" || j.status === "failed" || j.status === "skipped") {
        clearInterval(timer);
        router.refresh();
      }
    };
    const timer = setInterval(() => void tick(), 5000);
    void tick();
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [jobId, router]);

  const progress = (job?.payload as { progress?: Progress } | undefined)?.progress;
  const running = job ? job.status === "queued" || job.status === "running" : Boolean(jobId);

  return (
    <div className="rounded-lg border border-line bg-surface p-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="font-medium">Backfill history (24 months)</p>
          <p className="text-xs text-muted">Wayback captures of the watched pages at quarterly cutoffs, replayed as backfill runs. Roughly 8 runs, 20–40 minutes, about $5–10 with Opus synthesis.</p>
        </div>
        <Button
          variant="ghost"
          className="ml-auto"
          disabled={pending || running || !hasWatchlist}
          onClick={() =>
            start(async () => {
              const r = await enqueueBackfill(slug, competitorId);
              setMessage(r.message);
              if (r.ok && r.jobId) setJobId(r.jobId);
            })
          }
          title={hasWatchlist ? undefined : "Add watched pages first (Settings → Watchlist)"}
        >
          {running ? (
            <>
              <Spinner /> Backfilling…
            </>
          ) : (
            "Backfill history"
          )}
        </Button>
      </div>
      {message && <p className="mt-2 text-xs text-muted">{message}</p>}
      {job && (
        <div className="mt-3 rounded-md bg-bg p-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium">Job #{job.id} · {job.status}</span>
            {progress && (
              <>
                <span>
                  cutoffs {progress.cutoffsDone}/{progress.cutoffsTotal}
                </span>
                <span>{progress.pagesFetched} pages fetched</span>
                {progress.runsFailed > 0 && <span className="text-bad">{progress.runsFailed} run(s) failed</span>}
                <span className="text-muted">{progress.stage}</span>
              </>
            )}
            {job.error && <span className="text-bad">{job.error}</span>}
          </div>
          {progress && progress.cutoffsTotal > 0 && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round((100 * progress.cutoffsDone) / progress.cutoffsTotal)}%` }} />
            </div>
          )}
          {job.log.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-muted hover:text-fg">log ({job.log.length} lines)</summary>
              <div className="mt-1 max-h-48 overflow-y-auto font-mono leading-5">
                {job.log.slice(-60).map((l, i) => (
                  <div key={i}>
                    <span className="text-muted">{l.ts.slice(11, 19)}</span> {l.message}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
