"use client";

import { useTransition } from "react";
import { setInsightStatus } from "@/app/c/[slug]/actions";
import type { InsightStatus } from "@/db/schema";
import { cx } from "@/components/ui";

export function InsightStatusButtons({ slug, id, status, title }: { slug: string; id: number; status: InsightStatus; title: string }) {
  const [pending, start] = useTransition();
  const set = (s: InsightStatus) => start(() => void setInsightStatus(slug, id, s));
  const cls = "rounded border border-line px-2 py-0.5 text-xs text-muted hover:text-fg disabled:opacity-50";
  return (
    <span className="flex items-center gap-2">
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
