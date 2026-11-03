import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { SOURCE_TYPES } from "@/db/schema";
import { recordEvent } from "@/lib/events";
import { assertPublicHttpUrl, UnsafeUrlError } from "@/lib/ingest/safeUrl";
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
    assertPublicHttpUrl(parsed.data.url);
    const result = await createSnapshot(getDb(), { ...parsed.data, provider: "manual_url" });
    recordEvent(getDb(), "source_added", { url: parsed.data.url, competitorId: parsed.data.competitorId, via: "dashboard", created: result.created });
    const { rawHtml: _html, ...snapshot } = result.snapshot;
    void _html;
    return NextResponse.json({ created: result.created, snapshot });
  } catch (e) {
    const status = e instanceof FetchError || e instanceof UnsafeUrlError ? 422 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
