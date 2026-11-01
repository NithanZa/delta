import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "./index";
import * as schema from "./schema";

/**
 * Runs scripts/seed-competitor.ts as a child process against a temporary
 * database file, the same way `npm run seed:competitor` does.
 */
const tsxCli = path.resolve("node_modules/tsx/dist/cli.mjs");
const script = path.resolve("scripts/seed-competitor.ts");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "delta-seed-competitor-"));
const dbPath = path.join(tmpDir, "test.db");
const slug = "socialpilot";
const snapshotFiles = fs.readdirSync(path.resolve("data", "corpus", slug, "snapshots")).filter((f) => f.endsWith(".json"));
const seedQuestions = (JSON.parse(fs.readFileSync(path.resolve("data", "seed", "questions.json"), "utf8")) as Record<string, string[]>)[slug];

/** `$client` is on drizzle()'s return type, not on `Db`; close so the temp files can be deleted on Windows. */
function closeDb(db: ReturnType<typeof createDb>) {
  (db as unknown as { $client: { close(): void } }).$client.close();
}

function runSeed(args: string[]): string {
  return execFileSync(process.execPath, [tsxCli, script, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, DELTA_DB_PATH: dbPath },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe("seed:competitor", () => {
  it("adds the competitor, its questions and snapshots without touching existing rows, and is idempotent", { timeout: 120_000 }, () => {
    // An existing database with a company and another competitor that must survive.
    const db = createDb(dbPath);
    db.insert(schema.company).values({ name: "Loop" }).run();
    const buffer = db.insert(schema.competitors).values({ name: "Buffer", slug: "buffer" }).returning().get();
    db.insert(schema.researchQuestions).values({ competitorId: buffer.id, text: "Keep me" }).run();
    closeDb(db);

    const out = runSeed(["--slug", slug]);
    expect(out).toMatch(/Added SocialPilot \(socialpilot\)/);

    const db2 = createDb(dbPath);
    const competitors = db2.select().from(schema.competitors).all();
    expect(competitors.map((c) => c.slug).sort()).toEqual(["buffer", slug]);
    const sp = competitors.find((c) => c.slug === slug)!;
    expect(sp.website).toBe("https://www.socialpilot.co");

    const questions = db2.select().from(schema.researchQuestions).where(eq(schema.researchQuestions.competitorId, sp.id)).all();
    expect(questions.map((q) => q.text)).toEqual(seedQuestions);
    expect(db2.select().from(schema.researchQuestions).where(eq(schema.researchQuestions.competitorId, buffer.id)).all()).toHaveLength(1);

    const snapshots = db2.select().from(schema.snapshots).where(eq(schema.snapshots.competitorId, sp.id)).all();
    expect(snapshots).toHaveLength(snapshotFiles.length);
    expect(snapshots.every((s) => s.extractedText.length > 800)).toBe(true);
    expect(snapshots.every((s) => s.processedRunId === null)).toBe(true);
    const sources = db2.select().from(schema.sources).where(eq(schema.sources.competitorId, sp.id)).all();
    expect(sources.every((s) => s.provider === "seeded")).toBe(true);
    expect(sources.length).toBeLessThan(snapshots.length); // several captures of the same URL share one source
    expect(db2.select().from(schema.company).all()).toHaveLength(1);
    closeDb(db2);

    // Second run: nothing changes.
    expect(runSeed(["--slug", slug])).toMatch(/already exists/);
    const db3 = createDb(dbPath);
    expect(db3.select().from(schema.competitors).all()).toHaveLength(2);
    expect(db3.select().from(schema.snapshots).all()).toHaveLength(snapshotFiles.length);
    closeDb(db3);
  });

  it("fails with a readable message for an unknown slug", { timeout: 60_000 }, () => {
    expect(() => runSeed(["--slug", "does-not-exist"])).toThrow(/No competitor with slug "does-not-exist"/);
  });
});
