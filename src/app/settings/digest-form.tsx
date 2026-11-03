"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { saveDigestSettings, type SettingsState } from "./actions";

const initial: SettingsState = { ok: true, message: "" };
const inputCls = "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm focus:border-accent focus:outline-none";
const labelCls = "text-xs font-semibold uppercase tracking-wide text-muted";

export type DigestSettingsValues = { to: string[]; from: string; baseUrl: string; slackWebhookUrl: string; opsEmail: string };

export function DigestSettingsForm({ values }: { values: DigestSettingsValues }) {
  const [state, action, pending] = useActionState(saveDigestSettings, initial);
  return (
    <form action={action} className="grid gap-3">
      <label className="grid gap-1 text-sm">
        <span className={labelCls}>Recipients (one email per line)</span>
        <textarea name="to" rows={3} defaultValue={values.to.join("\n")} className={inputCls} placeholder="pm@partner.com" />
      </label>
      <label className="grid gap-1 text-sm">
        <span className={labelCls}>From (verified Resend domain)</span>
        <input name="from" defaultValue={values.from} className={inputCls} placeholder="Delta <delta@notify.example.com>" />
      </label>
      <label className="grid gap-1 text-sm">
        <span className={labelCls}>Public base URL (links in emails)</span>
        <input name="baseUrl" defaultValue={values.baseUrl} className={inputCls} placeholder="https://delta.example.com" />
      </label>
      <label className="grid gap-1 text-sm">
        <span className={labelCls}>Slack incoming webhook (optional)</span>
        <input name="slackWebhookUrl" defaultValue={values.slackWebhookUrl} className={inputCls} placeholder="https://hooks.slack.com/services/…" />
      </label>
      <label className="grid gap-1 text-sm">
        <span className={labelCls}>Ops email (held and failed digests)</span>
        <input name="opsEmail" defaultValue={values.opsEmail} className={inputCls} placeholder="you@example.com" />
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="ghost" disabled={pending}>
          {pending ? "Saving…" : "Save digest settings"}
        </Button>
        {state.message && <span className={state.ok ? "text-sm text-ok" : "text-sm text-bad"}>{state.message}</span>}
      </div>
    </form>
  );
}
