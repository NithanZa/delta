/**
 * Copy the pre-computed demo database (three completed replay runs) over the
 * working database so the UI is fully populated without any API call.
 *
 *   npm run demo:restore
 */
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";

const src = path.resolve(process.cwd(), "data", "demo", "delta.demo.db");
if (!fs.existsSync(src)) {
  console.error(`No demo database at ${src}. Run the replay and then \`npm run demo:snapshot\`.`);
  process.exit(1);
}
const dest = path.resolve(process.cwd(), env.dbPath);
fs.mkdirSync(path.dirname(dest), { recursive: true });
for (const suffix of ["", "-wal", "-shm"]) {
  const f = dest + suffix;
  if (suffix && fs.existsSync(f)) fs.rmSync(f);
}
fs.copyFileSync(src, dest);
console.log(`Restored ${dest} from ${src}`);
