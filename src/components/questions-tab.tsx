import { Badge, Card, EmptyState, SectionTitle } from "@/components/ui";
import { CorrectionForm } from "@/components/correction-form";
import { runLabel } from "@/components/overview";
import { linkRefs } from "@/components/refs";
import { resolveQuestion } from "@/app/c/[slug]/actions";
import type { Workspace } from "@/lib/queries";

export function QuestionsTab({ ws }: { ws: Workspace }) {
  if (ws.questions_open.length === 0 && ws.questions_resolved.length === 0) {
    return <EmptyState title="No follow-up questions yet">Delta turns important uncertainties into research tasks for the next run.</EmptyState>;
  }
  return (
    <div className="grid gap-6">
      <div>
        <SectionTitle>Open ({ws.questions_open.length}) — queued for the next run</SectionTitle>
        <div className="grid gap-3">
          {ws.questions_open.length === 0 && <p className="text-sm text-muted">Nothing open.</p>}
          {ws.questions_open.map((q) => (
            <Card key={q.id} id={`q-${q.id}`}>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="warn">open</Badge>
                <span className="text-xs text-muted">raised in {runLabel(ws.runs, q.createdRunId)}</span>
                <span className="ml-auto text-[11px] text-muted">Q{q.id}</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed">{linkRefs(q.question, ws.competitor.slug)}</p>
              <div className="mt-3">
                <CorrectionForm slug={ws.competitor.slug} id={q.id} action={resolveQuestion} current={null} label="Mark resolved" placeholder="What did you find out?" fieldName="resolution" ariaLabel={`Resolve question Q${q.id}`} />
              </div>
            </Card>
          ))}
        </div>
      </div>
      <div>
        <SectionTitle>Resolved ({ws.questions_resolved.length})</SectionTitle>
        <div className="grid gap-3">
          {ws.questions_resolved.length === 0 && <p className="text-sm text-muted">Nothing resolved yet.</p>}
          {ws.questions_resolved.map((q) => (
            <Card key={q.id} id={`q-${q.id}`} className="border-dashed bg-surface/60">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="ok">resolved</Badge>
                <span className="text-xs text-muted">
                  raised in {runLabel(ws.runs, q.createdRunId)} · resolved {q.resolvedRunId ? `in ${runLabel(ws.runs, q.resolvedRunId)}` : "by you"}
                </span>
                <span className="ml-auto text-[11px] text-muted">Q{q.id}</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed">{q.question}</p>
              {q.resolution && (
                <p className="mt-2 rounded-md border border-line bg-bg px-3 py-2 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">Resolution</span>
                  <br />
                  {q.resolution}
                </p>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
