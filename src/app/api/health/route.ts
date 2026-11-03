import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getSetting } from "@/lib/settings";

const WORKER_STALE_MS = 3 * 60 * 1000;

/**
 * Public health check. 503 when the database is unreachable or the worker has
 * stopped. `?scope=web` checks only this container (Docker's healthcheck, which
 * must not fail just because the worker has not started yet).
 */
export async function GET(request: Request) {
  const webOnly = new URL(request.url).searchParams.get("scope") === "web";
  const headers = { "cache-control": "no-store" };
  try {
    const db = getDb();
    db.get(sql`select 1`);
    const heartbeat = getSetting(db, "worker.heartbeatAt");
    const heartbeatAgeSeconds = heartbeat ? Math.round((Date.now() - new Date(heartbeat).getTime()) / 1000) : null;
    const workerOk = heartbeatAgeSeconds !== null && heartbeatAgeSeconds * 1000 < WORKER_STALE_MS;
    const lastDigest = db
      .select({ status: schema.digests.status, sentAt: schema.digests.sentAt })
      .from(schema.digests)
      .where(eq(schema.digests.channel, "email"))
      .orderBy(desc(schema.digests.id))
      .get();
    const ok = webOnly || workerOk;
    return Response.json({ ok, db: "ok", worker: { ok: workerOk, heartbeatAgeSeconds }, lastDigest: lastDigest ?? null }, { status: ok ? 200 : 503, headers });
  } catch (e) {
    return Response.json({ ok: false, db: "error", error: (e as Error).message }, { status: 503, headers });
  }
}
