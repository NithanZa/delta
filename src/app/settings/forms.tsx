"use client";

import { useActionState } from "react";
import type { Company } from "@/db/schema";
import { Button } from "@/components/ui";
import { saveCompany, saveQuestions, type SettingsState } from "./actions";

const initial: SettingsState = { ok: true, message: "" };

const fields: { name: keyof Company; label: string; rows?: number }[] = [
  { name: "name", label: "Company name" },
  { name: "description", label: "Description", rows: 2 },
  { name: "product", label: "Product", rows: 3 },
  { name: "targetCustomers", label: "Target customers", rows: 3 },
  { name: "positioning", label: "Positioning", rows: 2 },
  { name: "priorities", label: "Priorities", rows: 3 },
  { name: "constraints", label: "Constraints", rows: 2 },
];

const inputCls = "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm focus:border-accent focus:outline-none";

export function CompanyForm({ company }: { company: Company | null }) {
  const [state, action, pending] = useActionState(saveCompany, initial);
  return (
    <form action={action} className="grid gap-3">
      {fields.map((f) => (
        <label key={f.name} className="grid gap-1 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">{f.label}</span>
          {f.rows ? (
            <textarea name={f.name} rows={f.rows} defaultValue={(company?.[f.name] as string) ?? ""} className={inputCls} />
          ) : (
            <input name={f.name} defaultValue={(company?.[f.name] as string) ?? ""} className={inputCls} required />
          )}
        </label>
      ))}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </Button>
        {state.message && <span className={state.ok ? "text-sm text-ok" : "text-sm text-bad"}>{state.message}</span>}
      </div>
    </form>
  );
}

export function QuestionsForm({ competitorId, questions }: { competitorId: number; questions: string[] }) {
  const [state, action, pending] = useActionState(saveQuestions, initial);
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="competitorId" value={competitorId} />
      <textarea name="questions" rows={Math.max(5, questions.length + 1)} defaultValue={questions.join("\n")} className={inputCls} placeholder="One research question per line" />
      <div className="flex items-center gap-3">
        <Button type="submit" variant="ghost" disabled={pending}>
          {pending ? "Saving…" : "Save questions"}
        </Button>
        {state.message && <span className={state.ok ? "text-sm text-ok" : "text-sm text-bad"}>{state.message}</span>}
      </div>
    </form>
  );
}
