"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { Company } from "@/db/schema";
import { Button } from "@/components/ui";
import { addCompetitor, saveCompany, saveCompetitorDetails, saveQuestions, type AddCompetitorState, type SettingsState } from "./actions";

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
const labelCls = "text-xs font-semibold uppercase tracking-wide text-muted";

/** Generic versions of the Buffer research questions; the user edits them per competitor. */
const DEFAULT_QUESTIONS = [
  "Which customer segments are they increasingly targeting, and which are they de-emphasizing?",
  "How is their pricing and packaging changing, and which customers does it favor?",
  "Which product capabilities are they prioritizing, and what problems do those solve?",
  "How are they acquiring and distributing: partners, integrations, content, or product-led growth?",
  "What does their recent activity suggest about their next moves, and where does that create a threat or opportunity for us?",
];

function Status({ state }: { state: SettingsState }) {
  if (!state.message) return null;
  return <span className={state.ok ? "text-sm text-ok" : "text-sm text-bad"}>{state.message}</span>;
}

export function CompanyForm({ company }: { company: Company | null }) {
  const [state, action, pending] = useActionState(saveCompany, initial);
  return (
    <form action={action} className="grid gap-3">
      {fields.map((f) => (
        <label key={f.name} className="grid gap-1 text-sm">
          <span className={labelCls}>{f.label}</span>
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
        <Status state={state} />
      </div>
    </form>
  );
}

export function QuestionsForm({ competitorId, questions }: { competitorId: number; questions: string[] }) {
  const [state, action, pending] = useActionState(saveQuestions, initial);
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="competitorId" value={competitorId} />
      <textarea name="questions" rows={Math.max(5, questions.length + 1)} defaultValue={questions.join("\n")} className={inputCls} placeholder="One research question per line" aria-label="Research questions, one per line" />
      <div className="flex items-center gap-3">
        <Button type="submit" variant="ghost" disabled={pending}>
          {pending ? "Saving…" : "Save questions"}
        </Button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function CompetitorDetailsForm({ competitorId, website, description }: { competitorId: number; website: string; description: string }) {
  const [state, action, pending] = useActionState(saveCompetitorDetails, initial);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="competitorId" value={competitorId} />
      <label className="grid gap-1 text-sm">
        <span className={labelCls}>Website</span>
        <input name="website" type="text" inputMode="url" defaultValue={website} placeholder="https://example.com" className={inputCls} />
      </label>
      <label className="grid gap-1 text-sm">
        <span className={labelCls}>Description</span>
        <textarea name="description" rows={3} defaultValue={description} className={inputCls} />
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="ghost" disabled={pending}>
          {pending ? "Saving…" : "Save details"}
        </Button>
        <Status state={state} />
      </div>
    </form>
  );
}

const initialAdd: AddCompetitorState = { ok: true, message: "" };

export function AddCompetitorForm() {
  const [state, action, pending] = useActionState(addCompetitor, initialAdd);
  return (
    <form action={action} className="grid gap-3">
      <label className="grid gap-1 text-sm">
        <span className={labelCls}>Name</span>
        <input name="name" required placeholder="e.g. SocialPilot" className={inputCls} />
      </label>
      <label className="grid gap-1 text-sm">
        <span className={labelCls}>Website</span>
        <input name="website" type="text" inputMode="url" placeholder="https://example.com" className={inputCls} />
      </label>
      <label className="grid gap-1 text-sm">
        <span className={labelCls}>Description</span>
        <textarea name="description" rows={3} placeholder="What they sell, to whom, and how they position it" className={inputCls} />
      </label>
      <label className="grid gap-1 text-sm">
        <span className={labelCls}>Research questions (one per line)</span>
        <textarea name="questions" rows={6} defaultValue={DEFAULT_QUESTIONS.join("\n")} className={inputCls} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add competitor"}
        </Button>
        <Status state={state} />
        {state.ok && state.slug && (
          <Link href={`/c/${state.slug}`} className="text-sm text-accent underline">
            Open /c/{state.slug} →
          </Link>
        )}
      </div>
    </form>
  );
}
