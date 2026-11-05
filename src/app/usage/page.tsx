import Link from "next/link";
import type { ReactNode } from "react";
import { getDb } from "@/db";
import { Badge, Card, EmptyState, SectionTitle, cx } from "@/components/ui";
import { budgetStatus } from "@/lib/budget";
import { usageReport, type UsageTotal } from "@/lib/usage";

export const dynamic = "force-dynamic";

/** Small amounts matter here: most single calls cost under a cent. */
function usd(v: number | null): string {
  if (v === null) return "no price";
  if (v === 0) return "$0";
  if (v < 0.0001) return "<$0.0001";
  return v < 1 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

const Th = ({ children, right }: { children: ReactNode; right?: boolean }) => <th className={cx("py-1.5 pr-3 text-xs font-semibold uppercase tracking-wide text-muted", right ? "text-right" : "text-left")}>{children}</th>;
const Td = ({ children, right, mono }: { children: ReactNode; right?: boolean; mono?: boolean }) => <td className={cx("py-1.5 pr-3", right && "text-right tabular-nums", mono && "font-mono text-xs")}>{children}</td>;

/** Cost, calls and tokens for one row; a row with unpriced calls says its dollar figure is a lower bound. */
function TotalCells({ t }: { t: UsageTotal }) {
  return (
    <>
      <Td right>
        {usd(t.usd)}
        {t.unpriced > 0 && <span className="text-muted"> +?</span>}
      </Td>
      <Td right>{t.calls}</Td>
      <Td right>{t.promptTokens || t.completionTokens ? `${tokens(t.promptTokens)} / ${tokens(t.completionTokens)}` : "—"}</Td>
    </>
  );
}

const ServiceBadge = ({ service }: { service: "llm" | "exa" }) => <Badge tone={service === "llm" ? "accent" : "info"}>{service === "llm" ? "AI" : "Exa"}</Badge>;

/** Developer view of what the paid APIs have cost, from one row per call. */
export default function UsagePage() {
  const db = getDb();
  const { periods, days, byModel, byTask, recent, firstAt, competitorWeeks, digests } = usageReport(db);
  const unpriced = periods[periods.length - 1].total.unpriced;
  const budget = budgetStatus(db);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
          <p className="mt-1 text-xs text-muted">AI costs are estimates: tokens times list price when the call was made. Exa costs are what Exa reports per request. Your provider dashboards have the final bill.</p>
          {budget && (
            <p className={cx("mt-1 text-xs", budget.level > 0 ? "text-warn" : "text-muted")}>
              {usd(budget.spentUsd)} of the {usd(budget.budgetUsd)} monthly budget used in {budget.month}. Change it in Settings.
            </p>
          )}
        </div>
        <Link href="/ops" className="text-xs text-accent hover:underline">
          ← Operations
        </Link>
      </div>

      {firstAt === null ? (
        <EmptyState title="No paid calls recorded yet">Model and Exa calls appear here as soon as they are made. Mock-model runs cost nothing and are not recorded.</EmptyState>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {periods.map((p) => (
              <Card key={p.label}>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">{p.label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{usd(p.total.usd)}</p>
                <p className="mt-1 text-xs tabular-nums text-muted">
                  AI {usd(p.llm.usd)} · Exa {usd(p.exa.usd)} · {p.total.calls} call{p.total.calls === 1 ? "" : "s"}
                </p>
              </Card>
            ))}
          </div>

          {unpriced > 0 && (
            <p className="text-sm text-muted">
              <span className="text-fg">+?</span> means the total is too low: {unpriced} call{unpriced === 1 ? " has" : "s have"} no known price. Add the model to <code className="rounded bg-surface-2 px-1">LLM_PRICES_JSON</code> to price future calls.
            </p>
          )}

          <Card>
            <SectionTitle>By competitor and week</SectionTitle>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Week of</Th>
                  <Th>Competitor</Th>
                  <Th right>Extraction</Th>
                  <Th right>Synthesis</Th>
                  <Th right>Discovery</Th>
                  <Th right>Other</Th>
                  <Th right>Total</Th>
                </tr>
              </thead>
              <tbody>
                {competitorWeeks.map((w) => (
                  <tr key={`${w.week}/${w.competitorId}`} className="border-t border-line">
                    <Td mono>{w.week}</Td>
                    <Td>{w.name}</Td>
                    <Td right>{usd(w.stages.extraction)}</Td>
                    <Td right>{usd(w.stages.synthesis)}</Td>
                    <Td right>{usd(w.stages.discovery)}</Td>
                    <Td right>{usd(w.stages.other)}</Td>
                    <Td right>
                      {usd(w.usd)}
                      {w.unpriced > 0 && <span className="text-muted"> +?</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">Shared is spend no single competitor caused, such as onboarding drafts and digest wording, and calls recorded before competitors were tracked. A backfill shows up as a one-off spike in its week.</p>
          </Card>

          {digests.length > 0 && (
            <Card>
              <SectionTitle>By digest</SectionTitle>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>Digest</Th>
                    <Th>Period</Th>
                    <Th right>Spend in the period</Th>
                    <Th right>Calls</Th>
                  </tr>
                </thead>
                <tbody>
                  {digests.map((d) => (
                    <tr key={d.digestId} className="border-t border-line">
                      <Td>
                        <Link href={`/digests/${d.digestId}`} className="hover:text-accent hover:underline">
                          Digest {d.sequence}
                        </Link>
                      </Td>
                      <Td mono>
                        {d.periodStart.slice(0, 10)} → {d.periodEnd.slice(0, 10)}
                      </Td>
                      <Td right>
                        {usd(d.usd)}
                        {d.unpriced > 0 && <span className="text-muted"> +?</span>}
                      </Td>
                      <Td right>{d.calls}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <SectionTitle>By model, last 30 days</SectionTitle>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>Service</Th>
                    <Th>Model or endpoint</Th>
                    <Th right>Cost</Th>
                    <Th right>Calls</Th>
                    <Th right>Tokens in / out</Th>
                  </tr>
                </thead>
                <tbody>
                  {byModel.map((m) => (
                    <tr key={`${m.provider}/${m.model}`} className="border-t border-line">
                      <Td>
                        <ServiceBadge service={m.service} />
                      </Td>
                      <Td mono>
                        {m.model} <span className="text-muted">({m.provider})</span>
                      </Td>
                      <TotalCells t={m} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card>
              <SectionTitle>By task, last 30 days</SectionTitle>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>Service</Th>
                    <Th>Task</Th>
                    <Th right>Cost</Th>
                    <Th right>Calls</Th>
                    <Th right>Tokens in / out</Th>
                  </tr>
                </thead>
                <tbody>
                  {byTask.map((t) => (
                    <tr key={`${t.service}/${t.task}`} className="border-t border-line">
                      <Td>
                        <ServiceBadge service={t.service} />
                      </Td>
                      <Td mono>{t.task}</Td>
                      <TotalCells t={t} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          <Card>
            <SectionTitle>By day (UTC)</SectionTitle>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Day</Th>
                  <Th right>AI</Th>
                  <Th right>Exa</Th>
                  <Th right>Total</Th>
                  <Th right>Calls</Th>
                  <Th right>Tokens in / out</Th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.day} className="border-t border-line">
                    <Td mono>{d.day}</Td>
                    <Td right>{usd(d.llmUsd)}</Td>
                    <Td right>{usd(d.exaUsd)}</Td>
                    <TotalCells t={d} />
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card>
            <SectionTitle>Latest calls</SectionTitle>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>When (UTC)</Th>
                  <Th>Service</Th>
                  <Th>Model or endpoint</Th>
                  <Th>Task</Th>
                  <Th right>Tokens in / out</Th>
                  <Th right>Cost</Th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <Td mono>{r.createdAt.slice(0, 19).replace("T", " ")}</Td>
                    <Td>
                      <ServiceBadge service={r.service} />
                    </Td>
                    <Td mono>{r.model}</Td>
                    <Td mono>{r.task}</Td>
                    <Td right>{r.promptTokens || r.completionTokens ? `${tokens(r.promptTokens)} / ${tokens(r.completionTokens)}` : "—"}</Td>
                    <Td right>{usd(r.costUsd)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <p className="text-xs text-muted">Recording started {firstAt.slice(0, 10)}. Earlier spend is not included.</p>
        </>
      )}
    </div>
  );
}
