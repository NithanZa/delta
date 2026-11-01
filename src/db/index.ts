import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

const MIGRATIONS_FOLDER = path.resolve(process.cwd(), "drizzle");

/** Open (and migrate) a database at `dbPath`. Use ":memory:" for tests. */
export function createDb(dbPath: string = env.dbPath): Db {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 10000"); // the dev server and the CLI may share this file
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

// Single shared connection for the app; survives Next.js dev HMR via globalThis.
const g = globalThis as unknown as { __deltaDb?: Db };

export function getDb(): Db {
  if (!g.__deltaDb) g.__deltaDb = createDb();
  return g.__deltaDb;
}

export { schema };
