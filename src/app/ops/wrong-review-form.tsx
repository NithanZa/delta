"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { reviewWrong, type OpsState } from "./actions";

const initial: OpsState = { ok: true, message: "" };

export function WrongReviewForm({ reactionId }: { reactionId: number }) {
  const [state, action, pending] = useActionState(reviewWrong, initial);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="reactionId" value={reactionId} />
      <input name="note" maxLength={2000} placeholder="What you found (optional)" aria-label="What you found" className="min-w-64 flex-1 rounded-md border border-line bg-bg px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
      <Button type="submit" name="outcome" value="delta_wrong" variant="danger" disabled={pending} className="px-2 py-1 text-xs">
        Delta was wrong
      </Button>
      <Button type="submit" name="outcome" value="delta_right" variant="ghost" disabled={pending} className="px-2 py-1 text-xs">
        Delta was right
      </Button>
      {!state.ok && <span className="text-xs text-bad">{state.message}</span>}
    </form>
  );
}
