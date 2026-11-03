"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { recordDecision, type OpsState } from "./actions";

const initial: OpsState = { ok: true, message: "" };
const inputCls = "rounded-md border border-line bg-bg px-2 py-1.5 text-sm focus:border-accent focus:outline-none";

/** The pilot's primary signal: record when the partner confirms an insight changed a decision. */
export function DecisionForm() {
  const [state, action, pending] = useActionState(recordDecision, initial);
  return (
    <form action={action} className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <input name="insightId" type="number" min={1} placeholder="Insight id (optional)" aria-label="Insight id" className={`${inputCls} w-40`} />
        <input name="date" type="date" aria-label="Date of the decision" className={inputCls} />
      </div>
      <textarea name="text" rows={2} required minLength={5} placeholder="What did the partner do differently, in their words?" aria-label="What changed" className={`${inputCls} w-full`} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="ghost" disabled={pending} className="px-2 py-1 text-xs">
          {pending ? "Saving…" : "Record a decision influenced"}
        </Button>
        {state.message && <span className={state.ok ? "text-xs text-ok" : "text-xs text-bad"}>{state.message}</span>}
      </div>
    </form>
  );
}
