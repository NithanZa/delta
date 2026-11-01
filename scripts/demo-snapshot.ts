/**
 * Save the current working database as the shipped demo database.
 *
 *   npm run demo:snapshot
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { env } from "@/lib/env";

const src = path.resolve(process.cwd(), env.dbPath);
const dest = path.resolve(process.cwd(), "data", "demo", "delta.demo.db");
fs.mkdirSync(path.dirname(dest), { recursive: true });
// Checkpoint the WAL so the single file is complete, then copy it.
const db = new Database(src);
db.pragma("wal_checkpoint(TRUNCATE)");
db.close();
fs.copyFileSync(src, dest);
console.log(`Saved ${dest} (${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} MB)`);
