"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { saveDiscoverySettings, type SettingsState } from "./actions";

const initial: SettingsState = { ok: true, message: "" };
const inputCls = "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm focus:border-accent focus:outline-none";
const labelCls = "text-xs font-semibold uppercase tracking-wide text-muted";

export function DiscoverySettingsForm({ values }: { values: { enabled: boolean; maxNewPagesPerRun: number; lookbackDays: number; blockedDomains: string[] } }) {
  const [state, action, pending] = useActionState(saveDiscoverySettings, initial);
  return (
    <form action={action} className="grid gap-3">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={values.enabled} /> Run discovery on the schedule
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className={labelCls}>Max new pages per competitor per run</span>
          <input name="maxNewPagesPerRun" type="number" min={0} max={200} defaultValue={values.maxNewPagesPerRun} className={inputCls} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className={labelCls}>Look back (days)</span>
          <input name="lookbackDays" type="number" min={1} max={365} defaultValue={values.lookbackDays} className={inputCls} />
        </label>
      </div>
      <label className="grid gap-1 text-sm">
        <span className={labelCls}>Blocked domains (one per line)</span>
        <textarea name="blockedDomains" rows={4} defaultValue={values.blockedDomains.join("\n")} className={inputCls} />
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="ghost" disabled={pending}>
          {pending ? "Saving…" : "Save discovery settings"}
        </Button>
        {state.message && <span className={state.ok ? "text-sm text-ok" : "text-sm text-bad"}>{state.message}</span>}
      </div>
    </form>
  );
}
