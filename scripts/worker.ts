/**
 * The Delta worker: runs the schedule (crawl, weekly run, backup) and executes
 * jobs enqueued from /ops or the CLI. One job at a time.
 *
 *   npm run worker
 */
import { createDb } from "@/db";
import { env } from "@/lib/env";
import { startWorker } from "@/lib/jobs/worker";

const db = createDb(env.dbPath);
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
log(`worker started on ${env.dbPath}`);
const worker = startWorker(db, { log });

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} received; finishing the current job`);
    worker
      .stop()
      .then(() => {
        log("worker stopped");
        process.exit(0);
      })
      .catch((e) => {
        console.error(e);
        process.exit(1);
      });
  });
}
