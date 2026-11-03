"use client";

import { useActionState } from "react";
import type { JobKind } from "@/db/schema";
import { Button } from "@/components/ui";
import { enqueueJob, type OpsState } from "./actions";

const initial: OpsState = { ok: true, message: "" };

export function EnqueueButton({ kind, competitorId, label }: { kind: JobKind; competitorId?: number; label: string }) {
  const [state, action, pending] = useActionState(enqueueJob, initial);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="competitorId" value={competitorId ?? ""} />
      <Button type="submit" variant="ghost" disabled={pending} className="px-2 py-1 text-xs">
        {pending ? "Queuing…" : label}
      </Button>
      {state.message && <span className={state.ok ? "text-xs text-ok" : "text-xs text-bad"}>{state.message}</span>}
    </form>
  );
}
