import Link from "next/link";
import { HYPOTHESIS_CHANGES } from "@/db/schema";
import { Badge, Card, SectionTitle, cx } from "@/components/ui";
import { statusTone } from "@/components/overview";
import type { RunDelta as RunDeltaData, Workspace } from "@/lib/queries";

const pct = (v: number) => `${Math.round(v * 100)}%`;

function fmtWall(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return null;
  const s = Math.round(ms / 1000);
  return s >= 90 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

/** "56% → 70%" with an arrow colored by direction; unchanged confidence shows a neutral "=". */
export function ConfidenceMove({ prev, next }: { prev: number | null; next: number }) {
  if (prev === null) return <span className="text-xs tabular-nums text-muted">{pct(next)}</span>;
  const diff = Math.round(next * 100) - Math.round(prev * 100);
  const arrow = diff > 0 ? "↑" : diff < 0 ? "↓" : "=";
  const tone = diff > 0 ? "text-ok" : diff < 0 ? "text-bad" : "text-muted";
  return (
    <span className="whitespace-nowrap text-xs tabular-nums text-muted" title={diff === 0 ? "confidence unchanged" : `${diff > 0 ? "+" : ""}${diff} points`}>
      {pct(prev)} → {pct(next)}
      <span className={cx("ml-1 font-semibold", tone)} aria-label={diff > 0 ? "up" : diff < 0 ? "down" : "unchanged"}>
        {arrow}
      </span>
    </span>
  );
}

export function RunDelta({ ws, delta }: { ws: Workspace; delta: RunDeltaData }) {
  const { run, rows, counts } = delta;
  const wall = fmtWall(delta.wallMs);
  const changeCounts = HYPOTHESIS_CHANGES.filter((c) => counts[c] > 0);
  const meta = [
    delta.questionsResolved.length > 0 && `${delta.questionsResolved.length} question${delta.questionsResolved.length === 1 ? "" : "s"} resolved`,
    delta.questionsRaised.length > 0 && `${delta.questionsRaised.length} question${delta.questionsRaised.length === 1 ? "" : "s"} raised`,
    `${delta.eventsAdded} timeline event${delta.eventsAdded === 1 ? "" : "s"}`,
    `${delta.insightsWritten} insight${delta.insightsWritten === 1 ? "" : "s"}`,
  ].filter((x): x is string => Boolean(x));

  return (
    <section aria-labelledby="run-delta-title" data-testid="run-delta">
      <SectionTitle
        right={
          <Link href={`/c/${ws.competitor.slug}/runs/${run.id}`} className="text-xs text-accent hover:underline">
            Run details{wall ? ` · ${wall}` : ""} →
          </Link>
        }
      >
        <span id="run-delta-title">What changed in {run.label}</span>
      </SectionTitle>
      <Card className="grid grid-cols-1 gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
          {changeCounts.length === 0 && <span>No hypothesis updates in this run.</span>}
          {changeCounts.map((c) => (
            <span key={c} className="inline-flex items-center gap-1">
              <Badge tone={statusTone[c]}>{c}</Badge>
              <span className="font-semibold tabular-nums text-fg">{counts[c]}</span>
            </span>
          ))}
          <span className="hidden sm:inline" aria-hidden>
            ·
          </span>
          {meta.map((m) => (
            <span key={m} className="tabular-nums">
              {m}
            </span>
          ))}
        </div>

        {rows.length > 0 && (
          <ul className="grid grid-cols-1 gap-1.5 border-t border-line pt-3">
            {rows.map(({ update: u, hypothesis: h, supersedes }) => (
              <li key={u.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                <Badge tone={statusTone[u.change]} className="w-24 justify-center">
                  {u.change}
                </Badge>
                <a href={`#h-${h.id}`} className="shrink-0 text-xs font-semibold text-accent hover:underline">
                  H{h.id}
                </a>
                <span className="min-w-0 flex-1 leading-snug">
                  {u.change === "revised" && supersedes && <span className="text-muted line-through">{supersedes.statement} </span>}
                  <span className={cx(u.change === "retired" && "text-muted")}>{h.statement}</span>
                  {u.change === "retired" && h.supersededBy && (
                    <a href={`#h-${h.supersededBy.id}`} className="ml-1 text-xs text-accent hover:underline">
                      → H{h.supersededBy.id}
                    </a>
                  )}
                </span>
                <ConfidenceMove prev={u.prevConfidence} next={u.newConfidence} />
              </li>
            ))}
          </ul>
        )}

        {delta.trajectories.length > 0 && delta.trajectories[0].points.length > 1 && (
          <div className="border-t border-line pt-3">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              Confidence across {delta.trajectories[0].points.map((p) => p.run.label).join(" → ")}
            </p>
            <ul className="grid grid-cols-1 gap-1">
              {delta.trajectories.map(({ hypothesis: h, points }) => (
                <li key={h.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                  <a href={`#h-${h.id}`} className="w-8 shrink-0 font-semibold text-accent hover:underline">
                    H{h.id}
                  </a>
                  <span className="inline-flex items-center gap-1 tabular-nums" title={points.map((p) => `${p.run.label}: ${p.confidence === null ? "—" : pct(p.confidence)}`).join(" · ")}>
                    {points.map((p, i) => {
                      const prev = i > 0 ? points[i - 1].confidence : null;
                      const tone =
                        p.confidence === null ? "border-dashed text-muted" : prev === null || p.confidence === prev ? "text-fg" : p.confidence > prev ? "border-ok/40 text-ok" : "border-bad/40 text-bad";
                      return (
                        <span key={p.run.id} className="contents">
                          {i > 0 && <span className="text-muted">·</span>}
                          <span className={cx("rounded-md border border-line px-1.5 py-0.5", tone)}>{p.confidence === null ? "—" : pct(p.confidence)}</span>
                        </span>
                      );
                    })}
                  </span>
                  <span className={cx("min-w-0 flex-1 truncate text-muted", h.status === "retired" && "line-through")} title={h.statement}>
                    {h.statement}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </section>
  );
}
