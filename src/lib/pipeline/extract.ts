import pLimit from "p-limit";
import { and, desc, eq, isNull, lte, ne, lt } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { Fact, Run, Snapshot } from "@/db/schema";
import { callJson, MODELS, type LlmClient, type LlmUsage } from "@/lib/stepfun/client";
import type { CompanyContext } from "./context";
import type { OnEvent } from "./events";
import { ChangeOutput, ExtractFactsOutput, type FactOutput } from "./schemas";
import { extractFactsSystemPrompt, extractFactsUserPrompt } from "./prompts/extractFacts";
import { detectChangeSystemPrompt, detectChangeUserPrompt } from "./prompts/detectChange";
import { diffUnits } from "./diff";
import { quoteIsVerbatim } from "./verbatim";

export type ExtractionResult = {
  facts: Fact[];
  changes: Fact[];
  dropped: number;
  usage: LlmUsage;
  processedSnapshotIds: number[];
};

// The StepFun key allows 5 concurrent requests; leave headroom for the UI and retries.
const CONCURRENCY = 3;
const EXTRACT_MAX_TOKENS = 8192;

/** Snapshots dated on/before the cutoff that no run has processed yet. */
export function selectSnapshotsForRun(db: Db, competitorId: number, cutoffDate: string): Snapshot[] {
  return db
    .select()
    .from(schema.snapshots)
    .where(
      and(
        eq(schema.snapshots.competitorId, competitorId),
        lte(schema.snapshots.publishedAt, cutoffDate),
        isNull(schema.snapshots.processedRunId),
      ),
    )
    .orderBy(schema.snapshots.publishedAt, schema.snapshots.id)
    .all();
}

/** The most recent earlier capture of the same source with different content. */
export function previousSnapshotOf(db: Db, snapshot: Snapshot): Snapshot | undefined {
  return db
    .select()
    .from(schema.snapshots)
    .where(
      and(
        eq(schema.snapshots.sourceId, snapshot.sourceId),
        ne(schema.snapshots.id, snapshot.id),
        ne(schema.snapshots.contentHash, snapshot.contentHash),
        lt(schema.snapshots.publishedAt, snapshot.publishedAt),
      ),
    )
    .orderBy(desc(schema.snapshots.publishedAt), desc(schema.snapshots.id))
    .get();
}

function addUsage(total: LlmUsage, u: LlmUsage) {
  total.promptTokens += u.promptTokens;
  total.completionTokens += u.completionTokens;
}

/** Keep only facts whose quote really appears in the source text(s). */
export function filterVerbatim(items: FactOutput[], texts: string[]): { kept: FactOutput[]; dropped: FactOutput[] } {
  const kept: FactOutput[] = [];
  const dropped: FactOutput[] = [];
  for (const f of items) {
    if (texts.some((t) => quoteIsVerbatim(f.quote, t))) kept.push(f);
    else dropped.push(f);
  }
  return { kept, dropped };
}

function insertFacts(db: Db, run: Run, snapshot: Snapshot, items: FactOutput[], isChange: boolean): Fact[] {
  if (items.length === 0) return [];
  return db
    .insert(schema.facts)
    .values(
      items.map((f) => ({
        runId: run.id,
        competitorId: run.competitorId,
        snapshotId: snapshot.id,
        statement: f.statement,
        quote: f.quote,
        category: f.category,
        eventDate: f.eventDate ?? snapshot.publishedAt,
        importance: f.importance,
        isChange,
      })),
    )
    .returning()
    .all();
}

export async function extractFactsForSnapshot(
  db: Db,
  run: Run,
  snapshot: Snapshot,
  ctx: CompanyContext,
  client?: LlmClient,
): Promise<{ facts: Fact[]; dropped: FactOutput[]; usage: LlmUsage }> {
  const res = await callJson({
    task: "extract_facts",
    model: MODELS.fast,
    system: extractFactsSystemPrompt(ctx),
    user: extractFactsUserPrompt(snapshot),
    schema: ExtractFactsOutput,
    maxTokens: EXTRACT_MAX_TOKENS,
    reasoningEffort: "low",
    client,
  });
  const { kept, dropped } = filterVerbatim(res.data.facts, [snapshot.extractedText]);
  return { facts: insertFacts(db, run, snapshot, kept, false), dropped, usage: res.usage };
}

export async function detectChangesForSnapshot(
  db: Db,
  run: Run,
  snapshot: Snapshot,
  ctx: CompanyContext,
  client?: LlmClient,
): Promise<{ facts: Fact[]; dropped: FactOutput[]; usage: LlmUsage; previous?: Snapshot }> {
  const previous = previousSnapshotOf(db, snapshot);
  if (!previous) return { facts: [], dropped: [], usage: { promptTokens: 0, completionTokens: 0 } };
  const diff = diffUnits(previous.extractedText, snapshot.extractedText);
  // Only the differing lines go to the model; identical captures cost nothing.
  if (diff.removed.length === 0 && diff.added.length === 0) {
    return { facts: [], dropped: [], usage: { promptTokens: 0, completionTokens: 0 }, previous };
  }
  const res = await callJson({
    task: "detect_change",
    model: MODELS.fast,
    system: detectChangeSystemPrompt(ctx),
    user: detectChangeUserPrompt(snapshot.url, previous, snapshot, diff),
    schema: ChangeOutput,
    maxTokens: EXTRACT_MAX_TOKENS,
    reasoningEffort: "low",
    client,
  });
  const { kept, dropped } = filterVerbatim(res.data.changes, [snapshot.extractedText, previous.extractedText]);
  return { facts: insertFacts(db, run, snapshot, kept, true), dropped, usage: res.usage, previous };
}

/**
 * Extract facts (and same-URL changes) for every unprocessed snapshot up to
 * the run's cutoff. A snapshot that fails is logged and skipped so one bad
 * page never blocks a run.
 */
export async function runExtraction(
  db: Db,
  run: Run,
  ctx: CompanyContext,
  onEvent: OnEvent,
  client?: LlmClient,
): Promise<ExtractionResult> {
  const snapshots = selectSnapshotsForRun(db, run.competitorId, run.cutoffDate);
  onEvent({
    stage: "select",
    message: `${snapshots.length} snapshot(s) dated on or before ${run.cutoffDate} not yet analyzed`,
    data: { count: snapshots.length, snapshotIds: snapshots.map((s) => s.id) },
  });

  const result: ExtractionResult = {
    facts: [],
    changes: [],
    dropped: 0,
    usage: { promptTokens: 0, completionTokens: 0 },
    processedSnapshotIds: [],
  };
  const limit = pLimit(CONCURRENCY);

  await Promise.all(
    snapshots.map((snapshot) =>
      limit(async () => {
        const label = snapshot.title || snapshot.url;
        try {
          const extracted = await extractFactsForSnapshot(db, run, snapshot, ctx, client);
          addUsage(result.usage, extracted.usage);
          result.facts.push(...extracted.facts);
          result.dropped += extracted.dropped.length;
          for (const d of extracted.dropped) {
            onEvent({ stage: "extract", level: "warn", message: `Dropped a fact with a non-verbatim quote on ${label}: "${d.quote.slice(0, 80)}…"` });
          }

          // Change detection is best-effort: if it fails, keep the page's facts and move on.
          let changes: Awaited<ReturnType<typeof detectChangesForSnapshot>> = { facts: [], dropped: [], usage: { promptTokens: 0, completionTokens: 0 } };
          try {
            changes = await detectChangesForSnapshot(db, run, snapshot, ctx, client);
          } catch (e) {
            onEvent({ stage: "extract", level: "warn", message: `Change detection skipped for ${label}: ${(e as Error).message}` });
          }
          addUsage(result.usage, changes.usage);
          result.changes.push(...changes.facts);
          result.dropped += changes.dropped.length;
          for (const d of changes.dropped) {
            onEvent({ stage: "extract", level: "warn", message: `Dropped a change with a non-verbatim quote on ${label}: "${d.quote.slice(0, 80)}…"` });
          }

          db.update(schema.snapshots).set({ processedRunId: run.id }).where(eq(schema.snapshots.id, snapshot.id)).run();
          result.processedSnapshotIds.push(snapshot.id);
          onEvent({
            stage: "extract",
            message: `${label} (${snapshot.publishedAt}): ${extracted.facts.length} fact(s)${
              changes.previous ? `, ${changes.facts.length} change(s) vs ${changes.previous.publishedAt}` : ""
            }`,
            data: { snapshotId: snapshot.id, url: snapshot.url, factCount: extracted.facts.length, changeCount: changes.facts.length },
          });
        } catch (e) {
          onEvent({ stage: "extract", level: "error", message: `Skipped ${label}: ${(e as Error).message}`, data: { snapshotId: snapshot.id } });
        }
      }),
    ),
  );

  if (snapshots.length > 0 && result.processedSnapshotIds.length === 0) {
    throw new Error("extraction failed for every page (see the log above); nothing to synthesize");
  }
  return result;
}
