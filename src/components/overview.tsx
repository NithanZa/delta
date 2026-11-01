import Link from "next/link";
import type { Run, StrategyProfileJson } from "@/db/schema";
import { Badge, Card, ConfidenceBar, EmptyState, SectionTitle, cx, type BadgeTone } from "@/components/ui";
import { EvidenceList } from "@/components/evidence-list";
import { CorrectionForm } from "@/components/correction-form";
import { linkRefs } from "@/components/refs";
import { correctHypothesis } from "@/app/c/[slug]/actions";
import type { HypothesisWithHistory, Workspace } from "@/lib/queries";
import { factMap, snapshotMap } from "@/lib/queries";

const dimensionLabel: Record<string, string> = {
  customers: "Customers",
  product: "Product direction",
  productDirection: "Product direction",
  positioning: "Positioning",
  distribution: "Distribution",
  business_model: "Business model",
  businessModel: "Business model",
  next_moves: "Next moves",
};

export const statusTone: Record<string, BadgeTone> = {
  active: "neutral",
  strengthened: "ok",
  weakened: "warn",
  contradicted: "bad",
  revised: "info",
  retired: "neutral",
  created: "accent",
};

export function runLabel(runs: Run[], id: number | null): string {
  return runs.find((r) => r.id === id)?.label ?? `run ${id}`;
}

export function Overview({ ws }: { ws: Workspace }) {
  const facts = factMap(ws.facts);
  const snapshots = snapshotMap(ws.snapshots);
  const active = ws.hypotheses.filter((h) => h.status !== "retired");
  const retired = ws.hypotheses.filter((h) => h.status === "retired");

  if (!ws.profile && ws.hypotheses.length === 0) {
    return <EmptyState title="Nothing analyzed yet">Start Run 1 above. Delta will extract facts, form hypotheses and build the strategy profile.</EmptyState>;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.25fr]">
      <div>
        <SectionTitle right={ws.profile && <span className="text-xs text-muted">as of {runLabel(ws.runs, ws.profile.runId)}</span>}>Strategy profile</SectionTitle>
        {ws.profile ? (
          <div className="grid gap-3">
            {(Object.entries(ws.profile.profile) as [keyof StrategyProfileJson, StrategyProfileJson[keyof StrategyProfileJson]][]).map(([key, dim]) => (
              <Card key={key}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold">{dimensionLabel[key]}</h3>
                  <ConfidenceBar value={dim.confidence} />
                </div>
                <p className="mt-2 text-sm leading-relaxed">{dim.summary || <span className="text-muted">No view yet.</span>}</p>
                {dim.factIds.length > 0 && (
                  <Link href={`/c/${ws.competitor.slug}?tab=evidence&facts=${dim.factIds.join(",")}`} className="mt-2 inline-block text-xs text-accent hover:underline">
                    {dim.factIds.length} supporting fact{dim.factIds.length === 1 ? "" : "s"} →
                  </Link>
                )}
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState title="No strategy profile yet" />
        )}
      </div>

      <div>
        <SectionTitle>Hypotheses</SectionTitle>
        <div className="grid gap-3">
          {active.length === 0 && <EmptyState title="No active hypotheses" />}
          {active.map((h) => (
            <HypothesisCard key={h.id} h={h} ws={ws} facts={facts} snapshots={snapshots} />
          ))}
          {retired.length > 0 && (
            <details className="rounded-lg border border-line">
              <summary className="px-4 py-3 text-sm text-muted hover:text-fg">
                Superseded ({retired.length}) — earlier interpretations Delta has since revised
              </summary>
              <div className="grid gap-3 border-t border-line p-3">
                {retired.map((h) => (
                  <HypothesisCard key={h.id} h={h} ws={ws} facts={facts} snapshots={snapshots} />
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

export function HypothesisCard({
  h,
  ws,
  facts,
  snapshots,
  children,
}: {
  h: HypothesisWithHistory;
  ws: Workspace;
  facts: Map<number, import("@/db/schema").Fact>;
  snapshots: Map<number, import("@/db/schema").Snapshot>;
  children?: React.ReactNode;
}) {
  const superseded = h.supersedesId ? ws.hypotheses.find((o) => o.id === h.supersedesId) : null;
  return (
    <Card id={`h-${h.id}`} className={cx(h.status === "retired" && "border-dashed bg-surface/60")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge>{dimensionLabel[h.dimension]}</Badge>
        <Badge tone={statusTone[h.status]}>{h.status}</Badge>
        {h.userCorrection && <Badge tone="accent">corrected by you</Badge>}
        <span className="ml-auto text-xs text-muted">
          H{h.id} · updated in {runLabel(ws.runs, h.updatedRunId)}
        </span>
      </div>
      {superseded && <p className="mt-2 text-sm text-muted line-through">{superseded.statement}</p>}
      <p className={cx("mt-2 leading-relaxed", h.status === "retired" ? "text-sm" : "font-medium")}>{h.statement}</p>
      <div className="mt-2">
        <ConfidenceBar value={h.confidence} />
      </div>
      {h.userCorrection && (
        <p className="mt-2 rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-accent">Your correction</span>
          <br />
          {h.userCorrection}
        </p>
      )}
      {h.supersededBy && (
        <p className="mt-2 text-xs text-muted">
          Replaced by{" "}
          <a href={`#h-${h.supersededBy.id}`} className="text-accent hover:underline">
            H{h.supersededBy.id}
          </a>
        </p>
      )}
      {children}
      {h.status !== "retired" && (
        <div className="mt-3">
          <CorrectionForm slug={ws.competitor.slug} id={h.id} action={correctHypothesis} current={h.userCorrection} ariaLabel={`Correct hypothesis H${h.id}`} />
        </div>
      )}
      {h.history.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs text-muted hover:text-fg">
            History · {h.history.length} update{h.history.length === 1 ? "" : "s"} — how this conclusion changed
          </summary>
          <ol className="mt-2 grid gap-2 border-l border-line pl-3">
            {h.history.map((u) => (
              <li key={u.id} className="text-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={statusTone[u.change]}>{u.change}</Badge>
                  <span className="text-xs text-muted">{runLabel(ws.runs, u.runId)}</span>
                  <span className="text-xs tabular-nums text-muted">
                    {u.prevConfidence !== null ? `${Math.round(u.prevConfidence * 100)}% → ` : ""}
                    {Math.round(u.newConfidence * 100)}%
                  </span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-fg/90">{linkRefs(u.reasoning, ws.competitor.slug)}</p>
                {u.factIds.length > 0 && (
                  <details className="mt-1">
                    <summary className="text-xs text-accent hover:underline">
                      {u.factIds.length} fact{u.factIds.length === 1 ? "" : "s"} cited — show quotes
                    </summary>
                    <div className="mt-2">
                      <EvidenceList factIds={u.factIds} facts={facts} snapshots={snapshots} compact />
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
    </Card>
  );
}
