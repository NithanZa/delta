/**
 * Build dist/delta-submission.zip: the repository without node_modules, .next,
 * .env.local or the working database, but with the corpus and the demo DB.
 *
 *   npm run package
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const out = path.join(root, "dist", "delta-submission.zip");
fs.mkdirSync(path.dirname(out), { recursive: true });
if (fs.existsSync(out)) fs.rmSync(out);

const exclude = ["node_modules", ".next", "dist", ".env.local", ".git", "data/delta.db", "data/delta.db-wal", "data/delta.db-shm"];

function walk(dir: string, rel = ""): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (exclude.includes(relPath) || exclude.includes(entry.name)) continue;
    if (/\.db-(wal|shm)$/.test(entry.name)) continue; // SQLite side files
    if (entry.isDirectory()) files.push(...walk(path.join(dir, entry.name), relPath));
    else files.push(relPath);
  }
  return files;
}

const files = walk(root);
const listFile = path.join(root, "dist", "files.txt");
fs.writeFileSync(listFile, files.join("\n"));

// bsdtar ships with Windows 10+ (System32\tar.exe) and macOS; it writes a zip when the
// output name ends in .zip and keeps relative paths. (PowerShell's Compress-Archive flattens them.)
const tar = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
execFileSync(tar, ["-a", "-c", "-f", out, "-T", listFile], { cwd: root, stdio: "inherit" });
fs.rmSync(listFile);
console.log(`Wrote ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB, ${files.length} files)`);
