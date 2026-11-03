"use client";

import Link from "next/link";
import { useActionState } from "react";
import { COMPANY_FIELDS } from "@/lib/onboarding/fields";
import { Badge, Button, Spinner, cx } from "@/components/ui";
import { createCompetitorAction, draftCompanyAction, draftCompetitorAction, enqueueFromOnboarding, saveCompanyAction, type CompanyDraftState, type CompetitorDraftState, type SaveState } from "./actions";

const inputCls = "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm focus:border-accent focus:outline-none";
const labelCls = "text-xs font-semibold uppercase tracking-wide text-muted";

const FIELD_LABELS: Record<(typeof COMPANY_FIELDS)[number], { label: string; rows: number }> = {
  description: { label: "Description", rows: 2 },
  product: { label: "Product", rows: 3 },
  targetCustomers: { label: "Target customers", rows: 3 },
  positioning: { label: "Positioning", rows: 2 },
  priorities: { label: "Priorities", rows: 3 },
  constraints: { label: "Constraints", rows: 2 },
};

function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = value >= 0.7 ? "ok" : value >= 0.4 ? "warn" : "bad";
  return (
    <Badge tone={tone} title="How well the website supports this draft">
      {value === 0 ? "not drafted" : `site support ${pct}%`}
    </Badge>
  );
}

function Status({ state }: { state: { ok: boolean; message: string } }) {
  if (!state.message) return null;
  return <p className={cx("text-sm", state.ok ? "text-ok" : "text-bad")}>{state.message}</p>;
}

function UrlForm({ action, pending, label, placeholder, initialUrl, note }: { action: (fd: FormData) => void; pending: boolean; label: string; placeholder: string; initialUrl?: string; note: string }) {
  return (
    <form action={action} className="grid gap-2">
      <label className="grid gap-1 text-sm">
        <span className={labelCls}>{label}</span>
        <div className="flex flex-wrap gap-2">
          <input name="website" type="text" inputMode="url" required defaultValue={initialUrl ?? ""} placeholder={placeholder} className={cx(inputCls, "min-w-64 flex-1")} />
          <Button type="submit" disabled={pending}>
            {pending ? (
              <>
                <Spinner /> Reading the site…
              </>
            ) : (
              "Draft from the site"
            )}
          </Button>
        </div>
      </label>
      <p className="text-xs text-muted">{note}</p>
    </form>
  );
}

// ── Step 1 ───────────────────────────────────────────────────────────────────

export function CompanyStep({ initialUrl, existing }: { initialUrl?: string; existing: { name: string; website: string } | null }) {
  const [state, action, pending] = useActionState(draftCompanyAction, { ok: true, message: "" } as CompanyDraftState);
  const [saved, save, saving] = useActionState(saveCompanyAction, { ok: true, message: "" } as SaveState);
  const draft = state.draft;
  return (
    <div className="grid gap-4">
      {existing && !draft && (
        <p className="text-sm text-muted">
          A company profile already exists (<span className="text-fg">{existing.name}</span>). Drafting again prefills this form from the site; nothing is saved until you press save.
        </p>
      )}
      <UrlForm action={action} pending={pending} label="Your company's website" placeholder="https://yourcompany.com" initialUrl={initialUrl ?? existing?.website} note="Delta reads the home page and up to six commercial pages (pricing, product, customers, about) and drafts the profile. Typically 30–90 seconds." />
      <Status state={state} />
      {draft && (
        <form action={save} className="grid gap-4 rounded-lg border border-line bg-surface p-4">
          <input type="hidden" name="website" value={state.website ?? ""} />
          <input type="hidden" name="sourceUrls" value={JSON.stringify(state.sourceUrls ?? [])} />
          <label className="grid gap-1 text-sm">
            <span className={labelCls}>Company name</span>
            <input name="name" required defaultValue={draft.name} className={inputCls} />
          </label>
          {COMPANY_FIELDS.map((f) => (
            <label key={f} className="grid gap-1 text-sm">
              <span className="flex items-center gap-2">
                <span className={labelCls}>{FIELD_LABELS[f].label}</span>
                <Confidence value={draft.fieldConfidence[f] ?? 0} />
              </span>
              <textarea name={f} rows={FIELD_LABELS[f].rows} defaultValue={draft[f]} className={inputCls} />
            </label>
          ))}
          {draft.clarifyingQuestions.length > 0 && (
            <div className="grid gap-3 rounded-md border border-dashed border-line p-3">
              <p className="text-sm font-medium">Questions only your team can answer</p>
              <input type="hidden" name="questionCount" value={draft.clarifyingQuestions.length} />
              {draft.clarifyingQuestions.map((q, i) => (
                <label key={i} className="grid gap-1 text-sm">
                  <span>{q.question}</span>
                  <span className="text-xs text-muted">Why it matters: {q.whyItMatters || "refines the profile"} · refines {FIELD_LABELS[q.field]?.label ?? q.field}</span>
                  <input type="hidden" name={`q${i}_question`} value={q.question} />
                  <input type="hidden" name={`q${i}_why`} value={q.whyItMatters} />
                  <input type="hidden" name={`q${i}_field`} value={q.field} />
                  <textarea name={`q${i}_answer`} rows={2} placeholder="Optional, but the better the answer the better the digest" className={inputCls} />
                </label>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save company profile"}
            </Button>
            <Status state={saved} />
            {saved.ok && saved.next && (
              <Link href={saved.next} className="text-sm text-accent underline">
                Next: competitors →
              </Link>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

// ── Step 2 ───────────────────────────────────────────────────────────────────

export function CompetitorStep({ initialUrl, hasCompany }: { initialUrl?: string; hasCompany: boolean }) {
  const [state, action, pending] = useActionState(draftCompetitorAction, { ok: true, message: "" } as CompetitorDraftState);
  const [saved, save, saving] = useActionState(createCompetitorAction, { ok: true, message: "" } as SaveState);
  const draft = state.draft;
  return (
    <div className="grid gap-4">
      {!hasCompany && (
        <p className="text-sm text-bad">
          Set up your company first in <Link href="/onboarding?step=1" className="underline">step 1</Link>; competitor questions are tuned to its priorities.
        </p>
      )}
      <UrlForm action={action} pending={pending} label="Competitor's website" placeholder="https://competitor.com" initialUrl={initialUrl} note="Delta reads the site, drafts a profile, proposes which pages to watch, finds feeds and writes five research questions tuned to your priorities." />
      <Status state={state} />
      {draft && (
        <form action={save} className="grid gap-4 rounded-lg border border-line bg-surface p-4">
          <input type="hidden" name="website" value={state.website ?? ""} />
          <input type="hidden" name="profile" value={draft.profile ? JSON.stringify(draft.profile) : ""} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className={labelCls}>Name</span>
              <input name="name" required defaultValue={draft.name} className={inputCls} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className={labelCls}>Domain</span>
              <input value={draft.domain} readOnly className={cx(inputCls, "text-muted")} />
            </label>
          </div>
          <label className="grid gap-1 text-sm">
            <span className={labelCls}>Description</span>
            <textarea name="description" rows={2} defaultValue={draft.description} className={inputCls} />
          </label>
          {draft.profile && (
            <div className="grid gap-2 rounded-md border border-line bg-bg p-3 text-sm">
              <p className={labelCls}>Drafted profile (editable later in the record)</p>
              {(["segments", "pricingModel", "positioning", "distribution", "notable"] as const).map((k) => (
                <p key={k}>
                  <span className="font-medium">{k.replace(/([A-Z])/g, " $1").toLowerCase()}:</span> {draft.profile[k].text || <span className="text-muted">not stated</span>} <Confidence value={draft.profile[k].confidence} />
                </p>
              ))}
            </div>
          )}
          <div className="grid gap-2">
            <p className={labelCls}>Pages to watch</p>
            {draft.suggestedWatchlist.length === 0 && (state.otherPages?.length ?? 0) === 0 && <p className="text-sm text-muted">No pages found; add them later in Settings.</p>}
            {draft.suggestedWatchlist.map((w) => (
              <label key={w.url} className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="page" value={`${w.url}|${w.sourceType}|${w.watch ? "1" : "0"}`} defaultChecked className="mt-1" />
                <span>
                  <span className="font-medium">{w.url}</span> <Badge>{w.sourceType.replace("_", " ")}</Badge> {w.watch ? <Badge tone="accent">re-fetch</Badge> : <Badge tone="neutral">once</Badge>}
                  <br />
                  <span className="text-xs text-muted">{w.reason}</span>
                </span>
              </label>
            ))}
            {state.otherPages && state.otherPages.length > 0 && (
              <details>
                <summary className="text-xs text-muted hover:text-fg">Other pages found ({state.otherPages.length})</summary>
                <div className="mt-2 grid gap-1">
                  {state.otherPages.map((p) => (
                    <label key={p.url} className="flex items-start gap-2 text-sm">
                      <input type="checkbox" name="page" value={`${p.url}|${p.sourceType}|1`} className="mt-1" />
                      <span>
                        {p.title || p.url} <span className="text-xs text-muted">{p.url}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </details>
            )}
          </div>
          {draft.feeds.length > 0 && (
            <div className="grid gap-2">
              <p className={labelCls}>Feeds and sitemaps</p>
              {draft.feeds.map((f) => (
                <label key={f.url} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="feed" value={`${f.url}|${f.kind}`} defaultChecked />
                  <span>
                    {f.url} <Badge>{f.kind.replace("_", " ")}</Badge>
                  </span>
                </label>
              ))}
            </div>
          )}
          <label className="grid gap-1 text-sm">
            <span className={labelCls}>Research questions (one per line)</span>
            <textarea name="questions" rows={Math.max(5, draft.researchQuestions.length + 1)} defaultValue={draft.researchQuestions.join("\n")} className={inputCls} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className={labelCls}>Emphasis</span>
            <span className="text-sm">{draft.emphasisQuestion || "Is there one aspect of this competitor you want Delta to watch most closely?"}</span>
            <textarea name="emphasis" rows={2} placeholder="Optional" className={inputCls} />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save competitor"}
            </Button>
            <Status state={saved} />
            {saved.ok && saved.next && (
              <>
                <Link href={saved.next} className="text-sm text-accent underline">
                  Open the workspace →
                </Link>
                <Link href="/onboarding?step=3" className="text-sm text-accent underline">
                  Next: delivery →
                </Link>
              </>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

// ── Step 3 ───────────────────────────────────────────────────────────────────

export function JobButton({ kind, label, note }: { kind: "discovery" | "backfill" | "crawl"; label: string; note: string }) {
  const [state, action, pending] = useActionState(enqueueFromOnboarding, { ok: true, message: "" } as SaveState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="kind" value={kind} />
      <Button type="submit" variant="ghost" disabled={pending}>
        {pending ? "Queuing…" : label}
      </Button>
      <span className="text-xs text-muted">{note}</span>
      <Status state={state} />
    </form>
  );
}
