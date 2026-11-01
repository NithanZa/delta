"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui";
import type { ActionResult } from "@/app/c/[slug]/actions";

type Props = {
  slug: string;
  id: number;
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  current: string | null;
  label?: string;
  placeholder?: string;
  fieldName?: string;
  ariaLabel?: string;
};

/** Small inline textarea for "correct Delta's interpretation" and "resolve question". */
export function CorrectionForm({ slug, id, action, current, label = "Correct this interpretation", placeholder, fieldName = "text", ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, { ok: true, message: "" });

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setOpen(true)} className="rounded border border-accent/40 px-2 py-0.5 text-xs text-accent hover:bg-accent/10" aria-label={ariaLabel ?? label}>
          {current ? "Edit your correction" : label}
        </button>
        {state.message && <span className={state.ok ? "text-xs text-ok" : "text-xs text-bad"}>{state.message}</span>}
      </div>
    );
  }

  return (
    <form
      action={(fd) => {
        formAction(fd);
        setOpen(false);
      }}
      className="grid gap-2"
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="id" value={id} />
      <textarea
        name={fieldName}
        rows={3}
        defaultValue={current ?? ""}
        placeholder={placeholder ?? "What Delta got wrong, or what you know that it does not…"}
        aria-label={ariaLabel ?? label}
        className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm focus:border-accent focus:outline-none"
        autoFocus
      />
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
