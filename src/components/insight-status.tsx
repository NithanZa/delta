"use client";

import { useTransition } from "react";
import { setInsightStatus } from "@/app/c/[slug]/actions";
import type { InsightStatus } from "@/db/schema";

export function InsightStatusButtons({ slug, id, status }: { slug: string; id: number; status: InsightStatus }) {
  const [pending, start] = useTransition();
  const set = (s: InsightStatus) => start(() => void setInsightStatus(slug, id, s));
  return (
    <span className="flex items-center gap-2">
      {status !== "acknowledged" && (
        <button type="button" disabled={pending} onClick={() => set("acknowledged")} className="text-xs text-muted hover:text-fg disabled:opacity-50">
          Acknowledge
        </button>
      )}
      {status !== "dismissed" ? (
        <button type="button" disabled={pending} onClick={() => set("dismissed")} className="text-xs text-muted hover:text-bad disabled:opacity-50">
          Dismiss
        </button>
      ) : (
        <button type="button" disabled={pending} onClick={() => set("new")} className="text-xs text-muted hover:text-fg disabled:opacity-50">
          Restore
        </button>
      )}
    </span>
  );
}
