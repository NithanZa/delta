import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";
import { nextRun } from "@/lib/pipeline/presets";
import { executeRun, findActiveRun, startRun } from "@/lib/pipeline/run";

const Body = z.object({
  competitorId: z.coerce.number().int(),
  label: z.string().optional(),
  cutoffDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** Start a run and stream its progress as NDJSON events. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const db = getDb();
  const { competitorId } = parsed.data;

  const competitor = db.select().from(schema.competitors).where(eq(schema.competitors.id, competitorId)).get();
  if (!competitor) return NextResponse.json({ error: "Competitor not found" }, { status: 404 });

  const already = findActiveRun(db, competitorId);
  if (already) return NextResponse.json({ error: `${already.label} is already running`, runId: already.id }, { status: 409 });

  const preset = parsed.data.label && parsed.data.cutoffDate ? { kind: "manual" as const, label: parsed.data.label, cutoffDate: parsed.data.cutoffDate } : nextRun(db, competitorId);
  const run = startRun(db, { competitorId, ...preset });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (obj: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          open = false;
        }
      };
      send({ type: "start", runId: run.id, label: run.label, cutoffDate: run.cutoffDate });
      executeRun(db, run.id, (e) => send({ type: "event", ...e }))
        .then((result) => send({ type: "done", runId: result.id, status: result.status, error: result.error, stats: result.stats }))
        .catch((e) => send({ type: "done", runId: run.id, status: "failed", error: (e as Error).message }))
        .finally(() => {
          open = false;
          try {
            controller.close();
          } catch {
            // already closed by the client
          }
        });
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-run-id": String(run.id) },
  });
}
