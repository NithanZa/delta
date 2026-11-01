import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";

/** Run status + log, used by the UI to recover when the progress stream drops. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getDb()
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.id, Number(id)))
    .get();
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json(run, { headers: { "cache-control": "no-store" } });
}
