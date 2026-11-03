"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { setSourceWatch, type ActionResult } from "@/app/c/[slug]/actions";

const initial: ActionResult = { ok: true, message: "" };

/** Toggle whether the page behind a snapshot is re-fetched by the crawler. */
export function WatchToggle({ slug, sourceId, watch }: { slug: string; sourceId: number; watch: boolean }) {
  const [state, action, pending] = useActionState(setSourceWatch, initial);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="sourceId" value={sourceId} />
      <input type="hidden" name="watch" value={watch ? "0" : "1"} />
      <Button type="submit" variant="ghost" disabled={pending} className="px-2 py-1 text-xs" aria-label={watch ? "Stop watching this page" : "Watch this page"}>
        {pending ? "…" : watch ? "Watching · stop" : "Watch this page"}
      </Button>
      {state.message && <span className={state.ok ? "text-xs text-ok" : "text-xs text-bad"}>{state.message}</span>}
    </form>
  );
}
