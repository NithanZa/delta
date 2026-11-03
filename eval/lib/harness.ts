/**
 * Runs one regression case against an in-memory database and the configured
 * (or mocked) model, then evaluates the case's expectations and the quote /
 * point-in-time gates on what was stored.
 */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createDb, schema, type Db } from "@/db";
import type { Fact, Run } from "@/db/schema";
import { hashContent, insertSnapshotRecord } from "@/lib/ingest/snapshot";
import { addUsage, emptyUsage, type LlmClient, type LlmRole, type LlmTask, type LlmUsage } from "@/lib/llm/client";
import { MockLlmClient } from "@/lib/llm/mock";
import { loadCompanyContext } from "@/lib/pipeline/context";
import { detectChangesForSnapshot, extractFactsForSnapshot } from "@/lib/pipeline/extract";
import { loadResearchState } from "@/lib/pipeline/state";
import { runInsights, runSynthesis, type SynthesisResult } from "@/lib/pipeline/synthesize";
import { evaluate, excerpt, readFixture, type EvalCase, type FactSpec, type Row, type SnapshotSpec } from "./cases";
import { gatePointInTime, gateQuotes } from "./gates";

export type CaseResult = {
  id: string;
  kind: EvalCase["kind"];
  pass: boolean;
  failures: string[];
  usage: Record<LlmRole, LlmUsage>;
  /** Model output summary for the report. */
  excerpt: string;
  error?: string;
  durationMs: number;
  mocked: boolean;
};

/** Statement plus the fields the trust cases assert on. */
function factExcerpt(row: Row): string {
  const tags = [row.category, row.billingCadence, row.availability].filter(Boolean).join("/");
  return `[${tags}] ${excerpt(row, 100)}`;
}

function seedCompany(db: Db) {
  const file = path.resolve(process.cwd(), "data", "seed", "company.json");
  const company = JSON.parse(fs.readFileSync(file, "utf8")) as typeof schema.company.$inferInsert;
  db.insert(schema.company).values(company).run();
}

function addSnapshot(db: Db, competitorId: number, spec: SnapshotSpec) {
  const text = readFixture(spec.textFile);
  const { snapshot } = insertSnapshotRecord(db, competitorId, {
    url: spec.url,
    sourceType: spec.sourceType as (typeof schema.SOURCE_TYPES)[number],
    provider: "seeded",
    title: spec.title ?? spec.url,
    publishedAt: spec.publishedAt,
    fetchedAt: "2026-11-02T00:00:00.000Z",
    archiveUrl: null,
    rawHtml: "",
    extractedText: text,
    contentHash: hashContent(text),
  });
  return snapshot;
}

function insertFact(db: Db, run: Run, snapshotId: number, publishedAt: string, f: FactSpec): Fact {
  return db
    .insert(schema.facts)
    .values({
      runId: run.id,
      competitorId: run.competitorId,
      snapshotId,
      statement: f.statement,
      quote: f.quote,
      category: f.category,
      eventDate: f.eventDate === undefined ? publishedAt : f.eventDate,
      importance: f.importance,
      isChange: f.isChange,
    })
    .returning()
    .get();
}

/** Build a mock client whose canned outputs reference the ids created for this case. */
function mockClient(canned: Record<string, unknown>, ids: { F: number[]; H: number[]; Q: number[] }): MockLlmClient {
  const client = new MockLlmClient();
  for (const [task, output] of Object.entries(canned)) {
    client.on(task as LlmTask, () => {
      const text = JSON.stringify(output).replace(/"\{\{([FHQ]):(\d+)\}\}"/g, (_, kind: "F" | "H" | "Q", n: string) => String(ids[kind][Number(n)] ?? -1));
      return JSON.parse(text);
    });
  }
  return client;
}

export async function runCase(c: EvalCase, client?: LlmClient): Promise<CaseResult> {
  const t0 = Date.now();
  const usage: Record<LlmRole, LlmUsage> = { extract: emptyUsage(), synthesize: emptyUsage() };
  const failures: string[] = [];
  let summary = "";
  let error: string | undefined;
  const mocked = Boolean(c.mock);

  const db = createDb(":memory:");
  seedCompany(db);
  const comp = db.insert(schema.competitors).values({ name: c.competitor.name, slug: c.competitor.slug, website: c.competitor.website }).returning().get();
  for (const q of c.researchQuestions) db.insert(schema.researchQuestions).values({ competitorId: comp.id, text: q }).run();
  for (const s of c.extraSnapshots) addSnapshot(db, comp.id, s);
  const ctx = loadCompanyContext(db, comp.id);
  const silent = () => {};

  try {
    if (c.kind === "extract") {
      if (!c.snapshot) throw new Error("extract case needs `snapshot`");
      const snap = addSnapshot(db, comp.id, c.snapshot);
      const run = db.insert(schema.runs).values({ competitorId: comp.id, label: c.id, cutoffDate: c.cutoff ?? snap.publishedAt, status: "running" }).returning().get();
      const res = await extractFactsForSnapshot(db, run, snap, ctx, client);
      addUsage(usage.extract, res.usage);
      const items: Row[] = res.facts.map((f) => ({ ...f }));
      summary = items.map((i) => factExcerpt(i)).join(" | ");
      if (res.dropped.length) summary += ` || dropped (non-verbatim): ${res.dropped.map((d) => excerpt(d as unknown as Row, 80)).join(" | ")}`;
      if (c.expect.facts) failures.push(...evaluate("facts", items, c.expect.facts));
    } else if (c.kind === "change") {
      if (!c.previous || !c.current) throw new Error("change case needs `previous` and `current`");
      addSnapshot(db, comp.id, c.previous);
      const cur = addSnapshot(db, comp.id, c.current);
      const run = db.insert(schema.runs).values({ competitorId: comp.id, label: c.id, cutoffDate: c.cutoff ?? cur.publishedAt, status: "running" }).returning().get();
      const res = await detectChangesForSnapshot(db, run, cur, ctx, client);
      addUsage(usage.extract, res.usage);
      if (!res.previous) failures.push("changes: no previous capture was found for the current snapshot");
      const items: Row[] = res.facts.map((f) => ({ ...f }));
      summary = items.map((i) => factExcerpt(i)).join(" | ");
      if (res.dropped.length) summary += ` || dropped (non-verbatim): ${res.dropped.map((d) => excerpt(d as unknown as Row, 80)).join(" | ")}`;
      if (c.expect.changes) failures.push(...evaluate("changes", items, c.expect.changes));
    } else {
      if (!c.state) throw new Error(`${c.kind} case needs \`state\``);
      const cutoff = c.cutoff ?? "2026-10-31";
      const snaps = new Map<string, { id: number; publishedAt: string }>();
      for (const s of c.state.snapshots) {
        const row = addSnapshot(db, comp.id, s);
        snaps.set(s.key ?? s.url, { id: row.id, publishedAt: row.publishedAt });
      }
      const snapOf = (key: string) => {
        const s = snaps.get(key);
        if (!s) throw new Error(`fact references unknown snapshot key "${key}"`);
        return s;
      };
      const priorRun = db
        .insert(schema.runs)
        .values({ competitorId: comp.id, label: "Prior", cutoffDate: c.state.priorCutoff ?? cutoff, status: "done", finishedAt: "2026-01-01T00:00:00.000Z" })
        .returning()
        .get();
      const factByKey = new Map<string, Fact>();
      for (const f of c.state.priorFacts) {
        const s = snapOf(f.snapshot);
        const row = insertFact(db, priorRun, s.id, s.publishedAt, f);
        if (f.key) factByKey.set(f.key, row);
      }
      const hypIds: number[] = [];
      for (const h of c.state.hypotheses) {
        const row = db
          .insert(schema.hypotheses)
          .values({
            competitorId: comp.id,
            dimension: h.dimension,
            statement: h.statement,
            confidence: h.confidence,
            status: h.status,
            createdRunId: priorRun.id,
            updatedRunId: priorRun.id,
            userCorrection: h.userCorrection ?? null,
          })
          .returning()
          .get();
        hypIds.push(row.id);
        db.insert(schema.hypothesisUpdates)
          .values({
            hypothesisId: row.id,
            runId: priorRun.id,
            change: "created",
            prevConfidence: null,
            newConfidence: h.confidence,
            reasoning: "Created in the prior run (case fixture).",
            factIds: h.factKeys.map((k) => {
              const f = factByKey.get(k);
              if (!f) throw new Error(`hypothesis ${h.key} cites unknown fact key "${k}"`);
              return f.id;
            }),
          })
          .run();
      }
      const qIds = c.state.openQuestions.map((q) => db.insert(schema.openQuestions).values({ competitorId: comp.id, createdRunId: priorRun.id, question: q }).returning().get().id);

      const run = db.insert(schema.runs).values({ competitorId: comp.id, label: c.id, cutoffDate: cutoff, status: "running" }).returning().get();
      const newFacts = c.state.newFacts.map((f) => {
        const s = snapOf(f.snapshot);
        return insertFact(db, run, s.id, s.publishedAt, f);
      });
      const effectiveClient = c.mock ? mockClient(c.mock, { F: newFacts.map((f) => f.id), H: hypIds, Q: qIds }) : client;
      const state = loadResearchState(db, comp.id, run.id);

      let synthesis: SynthesisResult | undefined;
      let thrown: Error | undefined;
      try {
        synthesis = await runSynthesis(db, run, ctx, state, newFacts, silent, effectiveClient);
      } catch (e) {
        thrown = e as Error;
      }
      if (c.expect.throws) {
        if (!thrown) failures.push(`expected an error matching /${c.expect.throws}/ but synthesis completed`);
        else if (!new RegExp(c.expect.throws, "i").test(thrown.message)) failures.push(`error did not match /${c.expect.throws}/: ${thrown.message}`);
        summary = thrown ? `threw: ${thrown.message.slice(0, 160)}` : "completed";
      } else if (thrown) {
        throw thrown;
      }

      if (synthesis) {
        addUsage(usage.synthesize, synthesis.usage);
        const hypById = new Map(db.select().from(schema.hypotheses).where(eq(schema.hypotheses.competitorId, comp.id)).all().map((h) => [h.id, h]));
        const updateRows: Row[] = synthesis.hypothesisUpdates.map((u) => {
          const h = hypById.get(u.hypothesisId);
          return {
            ...u,
            confidence: u.newConfidence,
            statement: h?.statement,
            dimension: h?.dimension,
            status: h?.status,
            claimKind: (h as Record<string, unknown> | undefined)?.claimKind,
            factIdCount: u.factIds.length,
          };
        });
        const questionRows: Row[] = synthesis.questionsNew.map((q) => {
          const ids = (q as Record<string, unknown>).factIds;
          return { ...q, factIdCount: Array.isArray(ids) ? ids.length : 0 };
        });
        summary = [
          ...updateRows.map((u) => `${u.change} H${u.hypothesisId} ${Number(u.confidence).toFixed(2)}: ${excerpt(u, 90)}`),
          ...questionRows.map((q) => `Q: ${excerpt(q, 90)}`),
        ].join(" | ");
        if (c.expect.hypothesisUpdates) failures.push(...evaluate("hypothesisUpdates", updateRows, c.expect.hypothesisUpdates));
        if (c.expect.openQuestions) failures.push(...evaluate("openQuestions", questionRows, c.expect.openQuestions));
        if (c.expect.profile) {
          const profile = synthesis.profile.profile as unknown as Record<string, Row>;
          for (const [dim, m] of Object.entries(c.expect.profile)) {
            failures.push(...evaluate(`profile.${dim}`, [profile[dim] ?? {}], { mustInclude: [m] }));
          }
        }
        if (c.kind === "insights") {
          const ins = await runInsights(db, run, ctx, synthesis, newFacts, state, silent, effectiveClient);
          addUsage(usage.synthesize, ins.usage);
          const rows: Row[] = ins.insights.map((i) => ({ ...i, actionsText: i.actions.map((a) => `${a.text} ${a.rationale}`).join(" | ") }));
          summary += ` || insights: ${rows.map((r) => excerpt(r, 80)).join(" | ")}`;
          if (c.expect.insights) failures.push(...evaluate("insights", rows, c.expect.insights));
        }
      }
    }

    // Zero-tolerance gates on everything this case stored.
    for (const g of [gateQuotes(db), gatePointInTime(db)]) {
      if (g.violations.length) failures.push(`${g.id} ${g.name}: ${g.violations.slice(0, 5).join(", ")}`);
    }
  } catch (e) {
    error = (e as Error).message;
    failures.push(`error: ${error}`);
  }

  return { id: c.id, kind: c.kind, pass: failures.length === 0, failures, usage, excerpt: summary, error, durationMs: Date.now() - t0, mocked };
}
