import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { SOURCE_TYPES } from "@/db/schema";
import { createSnapshot, FetchError } from "@/lib/ingest/snapshot";

const Body = z.object({
  competitorId: z.coerce.number().int(),
  url: z.string().url(),
  sourceType: z.enum(SOURCE_TYPES).default("other"),
});

/** Live "Add URL": same pipeline as seeded pages, provider = manual_url. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid http(s) URL" }, { status: 400 });
  try {
    const result = await createSnapshot(getDb(), { ...parsed.data, provider: "manual_url" });
    const { rawHtml: _html, ...snapshot } = result.snapshot;
    void _html;
    return NextResponse.json({ created: result.created, snapshot });
  } catch (e) {
    const status = e instanceof FetchError ? 422 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
