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
};

const stageLabel: Record<string, string> = {
  select: "Select",
  extract: "Extract · step-3.7-flash",
  synthesis: "Synthesize · step-5-preview",
  insights: "Insights · step-5-preview",
  finalize: "Done",
  error: "Error",
};

export function RunPanel({ slug, competitorId, nextRun, runs, isRunning, pendingSnapshots, openQuestions }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "running" | "done" | "failed">(isRunning ? "running" : "idle");
  const [log, setLog] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<string>("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  // Fallback: if a run is in progress but we have no stream (page reload), poll it.
  useEffect(() => {
    if (status !== "running" || log.length > 0) return;
    const running = runs.find((r) => r.status === "running" || r.status === "queued");
    if (!running) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/runs/${running.id}`, { cache: "no-store" });
      if (!res.ok) return;
      const run = (await res.json()) as Run;
      setLog(run.log.map((l: RunLogEntry) => ({ stage: l.message.match(/^\[(\w+)\]/)?.[1] ?? "", message: l.message.replace(/^\[\w+\] /, ""), level: l.level })));
      if (run.status === "done" || run.status === "failed") {
        clearInterval(timer);
        setStatus(run.status);
        setError(run.error);
        router.refresh();
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [status, log.length, runs, router]);

  async function start() {
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
      // Stream dropped (long step-5-preview call, proxy timeout…): recover by polling the run row.
      if (runId) {
        for (;;) {
          await new Promise((r) => setTimeout(r, 2000));
          const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
          if (!res.ok) continue;
          const run = (await res.json()) as Run;
          if (run.status === "done" || run.status === "failed") {
            setStatus(run.status);
            setError(run.error);
            router.refresh();
            return;
          }
        }
      }
      setStatus("failed");
      setError((e as Error).message);
    }
  }

  const doneRuns = runs.filter((r) => r.status === "done" || r.status === "failed").slice().reverse();

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {doneRuns.length === 0 && <span className="text-sm text-muted">No runs yet.</span>}
          {doneRuns.map((r) => (
            <Link
              key={r.id}
              href={`/c/${slug}/runs/${r.id}`}
              className={cx("rounded-md border px-2.5 py-1 text-xs hover:bg-surface-2", r.status === "failed" ? "border-bad/40 text-bad" : "border-line")}
              title={`${r.label}: pages dated ≤ ${r.cutoffDate}`}
            >
              <span className="font-medium">{r.label}</span> <span className="text-muted">≤ {fmtDate(r.cutoffDate)}</span>
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

      {(log.length > 0 || error) && (
        <div className="mt-3">
          {error && (
            <div className="mb-2 rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
              Run failed: {error}
            </div>
          )}
          <div ref={logRef} className="max-h-56 overflow-y-auto rounded-md bg-bg p-3 font-mono text-xs leading-5">
            {log.map((l, i) => (
              <div key={i} className={cx("flex gap-2", l.level === "warn" && "text-warn", l.level === "error" && "text-bad")}>
                <Badge tone={l.stage === "finalize" ? "ok" : l.level === "error" ? "bad" : l.level === "warn" ? "warn" : "neutral"} className="shrink-0 font-mono">
                  {l.stage}
                </Badge>
                <span className="break-words">{l.message}</span>
              </div>
            ))}
            {status === "running" && (
              <div className="mt-1 flex items-center gap-2 text-muted">
                <Spinner /> working…
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
