"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { sendAnyway, type OpsState } from "./actions";

const initial: OpsState = { ok: true, message: "" };

export function SendAnywayForm({ digestId }: { digestId: number }) {
  const [state, action, pending] = useActionState(sendAnyway, initial);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="digestId" value={digestId} />
      <input name="reason" required minLength={5} placeholder="Why it is safe to send (recorded)" aria-label="Override reason" className="min-w-64 flex-1 rounded-md border border-line bg-bg px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
      <Button type="submit" variant="danger" disabled={pending} className="px-2 py-1 text-xs">
        {pending ? "Sending…" : "Send anyway"}
      </Button>
      {state.message && <span className={state.ok ? "text-xs text-ok" : "text-xs text-bad"}>{state.message}</span>}
    </form>
  );
}
