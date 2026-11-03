import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { Badge, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

/** The stored email as it was (or would be) sent. The markup is our own render output, not user input. */
export default async function DigestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const digest = getDb().select().from(schema.digests).where(eq(schema.digests.id, Number(id))).get();
  if (!digest) notFound();
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/digests" className="text-xs text-muted hover:text-accent">
          ← Digests
        </Link>
        <span className="font-mono text-xs text-muted">#{digest.id}</span>
        <Badge tone={digest.status === "sent" ? "ok" : digest.status === "held" ? "warn" : digest.status === "failed" ? "bad" : "neutral"}>{digest.status}</Badge>
        <span className="font-medium">{digest.subject}</span>
        <span className="text-xs text-muted">
          {fmtDate(digest.periodStart)} – {fmtDate(digest.periodEnd)}
        </span>
        {digest.error && <span className="text-xs text-bad">{digest.error}</span>}
      </div>
      <div className="overflow-hidden rounded-lg border border-line" dangerouslySetInnerHTML={{ __html: digest.html }} />
      <details>
        <summary className="text-xs text-muted hover:text-fg">Plain-text version</summary>
        <pre className="mt-2 overflow-x-auto rounded-md bg-bg p-3 text-xs">{digest.text}</pre>
      </details>
    </div>
  );
}
