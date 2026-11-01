/**
 * Fetch every page in data/corpus/{slug}/manifest.json and store it as a
 * snapshot JSON file. Re-runs skip files that already exist unless --force.
 *
 *   npm run corpus:fetch -- [--slug buffer] [--force]
 */
import fs from "node:fs";
import path from "node:path";
import { corpusDir, readManifest, type ManifestEntry } from "@/lib/ingest/providers";
import { buildSnapshotRecord, type SnapshotRecord } from "@/lib/ingest/snapshot";

const args = process.argv.slice(2);
const slug = args.includes("--slug") ? args[args.indexOf("--slug") + 1] : "buffer";
const force = args.includes("--force");

export function snapshotFileName(index: number, entry: ManifestEntry): string {
  const u = new URL(entry.url);
  const base = `${u.hostname}${u.pathname}`.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return `${String(index + 1).padStart(2, "0")}-${base}-${entry.publishedAt}.json`;
}

async function main() {
  const manifest = readManifest(slug);
  if (manifest.length === 0) {
    console.error(`No manifest at ${path.join(corpusDir(slug), "manifest.json")}`);
    process.exit(1);
  }
  const outDir = path.join(corpusDir(slug), "snapshots");
  fs.mkdirSync(outDir, { recursive: true });

  const rows: { file: string; status: string; chars: number; publishedAt: string }[] = [];
  for (const [i, entry] of manifest.entries()) {
    const file = snapshotFileName(i, entry);
    const out = path.join(outDir, file);
    if (fs.existsSync(out) && !force) {
      const existing = JSON.parse(fs.readFileSync(out, "utf8")) as SnapshotRecord;
      rows.push({ file, status: "cached", chars: existing.extractedText.length, publishedAt: existing.publishedAt });
      continue;
    }
    try {
      const rec = await buildSnapshotRecord({
        url: entry.url,
        sourceType: entry.sourceType,
        provider: "seeded",
        publishedAt: entry.publishedAt,
        archiveTimestamp: entry.archiveTimestamp,
        title: entry.title,
        fetchOptions: { timeoutMs: 90_000 },
      });
      fs.writeFileSync(out, JSON.stringify({ ...rec, note: entry.note ?? "" }, null, 2));
      rows.push({ file, status: "fetched", chars: rec.extractedText.length, publishedAt: rec.publishedAt });
    } catch (e) {
      rows.push({ file, status: `FAILED: ${(e as Error).message}`, chars: 0, publishedAt: entry.publishedAt });
    }
  }
  console.table(rows);
  const failed = rows.filter((r) => r.status.startsWith("FAILED"));
  if (failed.length) {
    console.error(`${failed.length} page(s) failed`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
