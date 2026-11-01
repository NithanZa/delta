import { env } from "@/lib/env";
import { createDb } from "@/db";
import { sql } from "drizzle-orm";

const db = createDb(env.dbPath);
const tables = db
  .all<{ name: string }>(sql`select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '__drizzle%'`)
  .map((r) => r.name);
console.log(`Migrated ${env.dbPath}: ${tables.length} tables`);
console.log(tables.join(", "));
