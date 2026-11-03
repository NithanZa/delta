"use client";

import { useTransition } from "react";
import { reactToInsight, setInsightStatus } from "@/app/c/[slug]/actions";
import type { InsightStatus, ReactionKind } from "@/db/schema";
import { cx } from "@/components/ui";

const REACTIONS: [ReactionKind, string][] = [
  ["useful", "Useful"],
  ["wrong", "Wrong"],
  ["acted_on", "Acted on"],
];

export function InsightStatusButtons({ slug, id, status, title, reacted = [] }: { slug: string; id: number; status: InsightStatus; title: string; reacted?: ReactionKind[] }) {
  const [pending, start] = useTransition();
  const set = (s: InsightStatus) => start(() => void setInsightStatus(slug, id, s));
  const reactWith = (k: ReactionKind) => start(() => void reactToInsight(slug, id, k));
  const cls = "rounded border border-line px-2 py-0.5 text-xs text-muted hover:text-fg disabled:opacity-50";
  return (
    <span className="flex flex-wrap items-center gap-2">
      {REACTIONS.map(([k, label]) => (
        <button
          key={k}
          type="button"
          disabled={pending || reacted.includes(k)}
          onClick={() => reactWith(k)}
          className={cx(cls, reacted.includes(k) && "border-accent/40 text-accent", k === "wrong" && "hover:text-bad", k === "acted_on" && "hover:text-ok")}
          aria-label={`${label}: ${title}`}
          aria-pressed={reacted.includes(k)}
        >
          {reacted.includes(k) ? `✓ ${label}` : label}
        </button>
      ))}
      <span className="text-muted">·</span>
      {status !== "acknowledged" && (
        <button type="button" disabled={pending} onClick={() => set("acknowledged")} className={cls} aria-label={`Acknowledge insight: ${title}`}>
          Acknowledge
        </button>
      )}
      {status !== "dismissed" ? (
        <button type="button" disabled={pending} onClick={() => set("dismissed")} className={cx(cls, "hover:text-bad")} aria-label={`Dismiss insight: ${title}`}>
          Dismiss
        </button>
      ) : (
        <button type="button" disabled={pending} onClick={() => set("new")} className={cls} aria-label={`Restore insight: ${title}`}>
          Restore
        </button>
      )}
    </span>
  );
}
