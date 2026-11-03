import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { getJob } from "@/lib/jobs/queue";

/** Job status + log for polling after "run now". */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(getDb(), Number(id));
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json(job, { headers: { "cache-control": "no-store" } });
}
