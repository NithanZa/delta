"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Run, RunLogEntry } from "@/db/schema";
import { Badge, Button, Spinner, cx, fmtDate } from "@/components/ui";

type LogLine = { stage: string; message: string; level: "info" | "warn" | "error" };
type Props = {
  slug: string;
  competitorId: number;
  nextRun: { label: string; cutoffDate: string };
  runs: Run[];
  isRunning: boolean;
  pendingSnapshots: number;
  openQuestions: number;
  /** Configured model id per role, for stage labels. */
  models: { extract: string; synthesize: string };
};

function logFromRun(run: Run): LogLine[] {
  return run.log.map((l: RunLogEntry) => ({ stage: l.message.match(/^\[(\w+)\]/)?.[1] ?? "", message: l.message.replace(/^\[\w+\] /, ""), level: l.level }));
}

export function RunPanel({ slug, competitorId, nextRun, runs, isRunning, pendingSnapshots, openQuestions, models }: Props) {
  const stageLabel: Record<string, string> = {
    select: "Select",
    extract: `Extract · ${models.extract}`,
    synthesis: `Synthesize · ${models.synthesize}`,
    insights: `Insights · ${models.synthesize}`,
    finalize: "Done",
    error: "Error",
  };
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "running" | "done" | "failed">(isRunning ? "running" : "idle");
  const [log, setLog] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStageState] = useState<string>("");
  const [now, setNow] = useState(0);
  const stageStartedAt = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const streaming = useRef(false);

  const setStage = (s: string) => {
    if (s !== stage) stageStartedAt.current = Date.now();
    setStageState(s);
  };

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  // Elapsed-time ticker while a run is in progress.
  useEffect(() => {
    if (status !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status]);

  // Fallback: a run is in progress but this page has no stream (page reload) → poll it.
  useEffect(() => {
    if (status !== "running" || streaming.current) return;
    const running = runs.find((r) => r.status === "running" || r.status === "queued");
    if (!running) return;
    let attempts = 0;
    const timer = setInterval(async () => {
      if (++attempts > 900) {
        clearInterval(timer);
        setStatus("failed");
        setError("Gave up waiting for the run after 30 minutes. Reload the page.");
        return;
      }
      const res = await fetch(`/api/runs/${running.id}`, { cache: "no-store" });
      if (res.status === 404) {
        clearInterval(timer);
        setStatus("failed");
        setError("This run no longer exists (database reset?). Reload the page.");
        return;
      }
      if (!res.ok) return;
      const run = (await res.json()) as Run;
      setLog(logFromRun(run));
      if (run.status === "done" || run.status === "failed") {
        clearInterval(timer);
        setStatus(run.status);
        setError(run.error);
        router.refresh();
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [status, runs, router]);

  async function start() {
    streaming.current = true;
    setStatus("running");
    setLog([]);
    setError(null);
    setStage("select");
    let runId: number | null = null;
    try {
      const res = await fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ competitorId }) });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      runId = Number(res.headers.get("x-run-id"));
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line);
          if (evt.type === "event") {
            setStage(evt.stage);
            setLog((l) => [...l, { stage: evt.stage, message: evt.message, level: evt.level ?? "info" }]);
          } else if (evt.type === "done") {
            setStatus(evt.status === "done" ? "done" : "failed");
            setError(evt.error ?? null);
            router.refresh();
          }
        }
      }
    } catch (e) {
      // Stream dropped (long synthesis call, proxy timeout…): recover by polling the run row.
      if (runId) {
        for (let attempt = 0; attempt < 900; attempt++) {
          await new Promise((r) => setTimeout(r, 2000));
          const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
          if (res.status === 404) break;
          if (!res.ok) continue;
          const run = (await res.json()) as Run;
          setLog(logFromRun(run));
          if (run.status === "done" || run.status === "failed") {
            setStatus(run.status);
            setError(run.error);
            router.refresh();
            streaming.current = false;
            return;
          }
        }
      }
      setStatus("failed");
      setError((e as Error).message);
    } finally {
      streaming.current = false;
    }
  }

  const doneRuns = runs
    .filter((r) => (r.status === "done" || r.status === "failed") && r.kind !== "check")
    .slice()
    .reverse();

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {doneRuns.length === 0 && status !== "running" && <span className="text-sm text-muted">No runs yet.</span>}
          {runs
            .filter((r) => r.status === "running" || r.status === "queued")
            .map((r) => (
              <span key={r.id} className="rounded-md border border-accent/40 px-2.5 py-1 text-xs text-accent">
                {r.label} · {r.kind === "scheduled" ? "scheduled run in progress" : r.kind === "backfill" ? "backfill in progress" : "in progress"}
              </span>
            ))}
          {doneRuns.map((r) => (
            <Link
              key={r.id}
              href={`/c/${slug}/runs/${r.id}`}
              className={cx("rounded-md border px-2.5 py-1 text-xs hover:bg-surface-2", r.status === "failed" ? "border-bad/40 text-bad" : "border-line")}
              title={`${r.label}: pages dated ≤ ${r.cutoffDate}`}
            >
              <span className="font-medium">{r.label}</span> <span className="text-muted">≤ {fmtDate(r.cutoffDate)}</span>
              {r.kind !== "replay" && r.kind !== "manual" && <span className="ml-1 rounded bg-surface-2 px-1 text-[10px] uppercase tracking-wide text-muted">{r.kind}</span>}
              {r.status === "done" && (
                <span className="text-muted">
                  {" "}
                  · {r.stats.facts ?? 0} facts · {r.stats.insights ?? 0} insights
                </span>
              )}
              {r.status === "failed" && " · failed"}
            </Link>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3">
          {(pendingSnapshots > 0 || openQuestions > 0) && status !== "running" && (
            <span className="text-xs text-muted">
              {pendingSnapshots > 0 && `${pendingSnapshots} page${pendingSnapshots === 1 ? "" : "s"} waiting`}
              {pendingSnapshots > 0 && openQuestions > 0 && " · "}
              {openQuestions > 0 && `${openQuestions} follow-up${openQuestions === 1 ? "" : "s"} queued`}
            </span>
          )}
          <Button onClick={start} disabled={status === "running"}>
            {status === "running" ? (
              <>
                <Spinner /> {stageLabel[stage] ?? "Running"}…
              </>
            ) : (
              <>
                Run {nextRun.label} <span className="font-normal opacity-80">(pages dated ≤ {fmtDate(nextRun.cutoffDate)})</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {(log.length > 0 || error || status === "done") && (
        <div className="mt-3">
          {error && (
            <div className="mb-2 rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
              Run failed: {error}
            </div>
          )}
          {status === "done" && !error && (
            <div className="mb-2 rounded-md border border-ok/40 bg-ok/10 px-3 py-2 text-sm text-ok">
              Run finished.{" "}
              <Link href={`/c/${slug}?tab=insights`} className="underline">
                See the new insights →
              </Link>
            </div>
          )}
          <div ref={logRef} className="max-h-56 overflow-y-auto rounded-md bg-bg p-3 font-mono text-xs leading-5">
            {log.map((l, i) => (
              <div key={i} className={cx("flex gap-2", l.level === "warn" && "text-warn", l.level === "error" && "text-bad")}>
                <Badge tone={l.stage === "finalize" ? "ok" : l.level === "error" ? "bad" : l.level === "warn" ? "warn" : "neutral"} className="shrink-0 font-mono">
                  {stageLabel[l.stage] ?? l.stage}
                </Badge>
                <span className="break-words">{l.message}</span>
              </div>
            ))}
            {status === "running" && (
              <div className="mt-1 flex items-center gap-2 text-muted">
                <Spinner /> {stageLabel[stage] ?? "Working"} · {now ? Math.max(0, Math.floor((now - stageStartedAt.current) / 1000)) : 0}s
                {(stage === "synthesis" || stage === "insights") && ` — ${models.synthesize} is reasoning over every fact so far; this step usually takes 1–3 minutes`}
                {stage === "extract" && " — pages are read 3 at a time"}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
