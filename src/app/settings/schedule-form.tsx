"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import type { Schedule } from "@/lib/settings";
import { saveSchedule, type SettingsState } from "./actions";

const initial: SettingsState = { ok: true, message: "" };
const inputCls = "w-full rounded-md border border-line bg-bg px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none";
const labelCls = "text-xs font-semibold uppercase tracking-wide text-muted";

export function ScheduleForm({ schedule, nextRuns }: { schedule: Schedule; nextRuns: Record<"crawl" | "run" | "digest" | "discovery", string> }) {
  const [state, action, pending] = useActionState(saveSchedule, initial);
  const rows: { name: keyof Schedule; label: string; next?: string }[] = [
    { name: "timezone", label: "Timezone (IANA)" },
    { name: "crawlCron", label: "Crawl watched pages and feeds", next: nextRuns.crawl },
    { name: "runCron", label: "Research run", next: nextRuns.run },
    { name: "digestCron", label: "Digest (phase 7)", next: nextRuns.digest },
    { name: "discoveryCron", label: "Discovery sweep (phase 8)", next: nextRuns.discovery },
  ];
  return (
    <form action={action} className="grid gap-3">
      {rows.map((r) => (
        <label key={r.name} className="grid gap-1 text-sm">
          <span className={labelCls}>
            {r.label}
            {r.next && <span className="ml-2 font-normal normal-case tracking-normal text-muted">next: {r.next}</span>}
          </span>
          <input name={r.name} defaultValue={schedule[r.name]} className={inputCls} required />
        </label>
      ))}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="ghost" disabled={pending}>
          {pending ? "Saving…" : "Save schedule"}
        </Button>
        {state.message && <span className={state.ok ? "text-sm text-ok" : "text-sm text-bad"}>{state.message}</span>}
      </div>
    </form>
  );
}
