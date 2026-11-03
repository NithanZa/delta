/**
 * Absence checks: an explicit, recorded attempt to find a page or
 * announcement on a topic (partner program, public API, SSO…). "Found"
 * snapshots the page; "not found" records a check snapshot and an absence
 * fact that synthesis may cite for an absence hypothesis above 0.4.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { AbsenceTopic, FactCategory, SourceType } from "@/db/schema";
import { ABSENCE_TOPICS } from "@/db/schema";
import { exaConfigured, exaSearch, type ExaOptions } from "@/lib/ingest/exa";
import { extractReadable } from "@/lib/ingest/extract";
import { fetchPage } from "@/lib/ingest/fetchPage";
import { createSnapshot, hashContent, insertSnapshotRecord } from "@/lib/ingest/snapshot";
import { domainFromWebsite, isOnDomain, sourceTypeForPath } from "@/lib/ingest/watchlist";

export type TopicSpec = { label: string; paths: string[]; query: string; keywords: RegExp; category: FactCategory; sourceType: SourceType };

export const TOPICS: Record<AbsenceTopic, TopicSpec> = {
  partner_program: { label: "partner, affiliate or reseller program", paths: ["/partners", "/partner-program", "/affiliates", "/affiliate", "/resellers", "/agencies", "/agency"], query: "partner program OR affiliate program OR reseller program OR referral commission", keywords: /(partner\s*program|affiliate|reseller|referral\s*(program|commission)|commission)/i, category: "distribution", sourceType: "website" },
  enterprise_tier: { label: "enterprise tier", paths: ["/enterprise", "/pricing", "/plans"], query: "enterprise plan OR custom pricing OR contact sales", keywords: /enterprise/i, category: "pricing", sourceType: "pricing" },
  public_api: { label: "public API", paths: ["/developers", "/api", "/docs/api", "/developer"], query: "public API OR developer API OR API documentation", keywords: /(public\s*api|developer\s*api|api\s*(documentation|reference|key|access)|rest\s*api)/i, category: "product", sourceType: "docs" },
  sso_saml: { label: "SSO / SAML", paths: ["/security", "/enterprise", "/sso"], query: "SSO OR SAML OR single sign-on", keywords: /(\bsso\b|\bsaml\b|single\s*sign[- ]?on)/i, category: "product", sourceType: "website" },
  white_label: { label: "white-label", paths: ["/white-label", "/agencies", "/agency", "/features"], query: "white label OR white-label reports OR custom branding", keywords: /\bwhite[- ]?label/i, category: "product", sourceType: "website" },
  marketplace: { label: "marketplace or app directory", paths: ["/marketplace", "/apps", "/integrations", "/app-directory"], query: "marketplace OR app directory OR integrations directory", keywords: /(marketplace|app\s*directory|apps?\s*(store|directory))/i, category: "distribution", sourceType: "website" },
  free_plan: { label: "free plan", paths: ["/pricing", "/plans", "/free"], query: "free plan OR free forever OR free tier", keywords: /free\s*(plan|forever|tier)/i, category: "pricing", sourceType: "pricing" },
};

export const RECHECK_DAYS = 30;

export type AbsenceOptions = {
  now?: Date;
  fetchImpl?: typeof fetch;
  exa?: ExaOptions;
  /** Use Exa even when EXA_API_KEY is unset (tests inject a fake fetch). */
  useExa?: boolean;
  topics?: AbsenceTopic[];
  force?: boolean;
  log?: (m: string) => void;
};

export type AbsenceResult = { checked: number; found: number; notFound: number; skipped: number; errors: number };

function due(db: Db, competitorId: number, topic: AbsenceTopic, now: Date): boolean {
  const last = db
    .select()
    .from(schema.absenceChecks)
    .where(and(eq(schema.absenceChecks.competitorId, competitorId), eq(schema.absenceChecks.topic, topic)))
    .all()
    .sort((a, b) => b.id - a.id)[0];
  if (!last) return true;
  return now.getTime() - new Date(last.checkedAt).getTime() >= RECHECK_DAYS * 86_400_000;
}

/** The bookkeeping run that owns absence facts (never shown as a research run). */
function checkRun(db: Db, competitorId: number, now: Date) {
  const date = now.toISOString().slice(0, 10);
  const label = `Absence checks ${date}`;
  const existing = db
    .select()
    .from(schema.runs)
    .where(and(eq(schema.runs.competitorId, competitorId), eq(schema.runs.label, label), eq(schema.runs.kind, "check")))
    .get();
  if (existing) return existing;
  return db
    .insert(schema.runs)
    .values({ competitorId, label, cutoffDate: date, kind: "check", status: "done", startedAt: now.toISOString(), finishedAt: now.toISOString() })
    .returning()
    .get();
}

export async function runAbsenceChecks(db: Db, competitorId: number, opts: AbsenceOptions = {}): Promise<AbsenceResult> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const competitor = db.select().from(schema.competitors).where(eq(schema.competitors.id, competitorId)).get();
  if (!competitor) throw new Error(`Competitor ${competitorId} not found`);
  const domain = competitor.domain || domainFromWebsite(competitor.website);
  const base = `https://${domain}`;
  const result: AbsenceResult = { checked: 0, found: 0, notFound: 0, skipped: 0, errors: 0 };
  const useExa = opts.useExa ?? exaConfigured();

  for (const topic of opts.topics ?? ABSENCE_TOPICS) {
    if (!opts.force && !due(db, competitorId, topic, now)) {
      result.skipped++;
      continue;
    }
    const spec = TOPICS[topic];
    const urlsChecked: string[] = [];
    const queries: string[] = [];
    let found: { url: string; title: string; text: string } | null = null;
    result.checked++;
    try {
      // 1. Probe the usual paths on the competitor's own domain.
      for (const path of spec.paths) {
        const url = `${base}${path}`;
        urlsChecked.push(url);
        try {
          const page = await fetchPage(url, { fetchImpl: opts.fetchImpl, timeoutMs: 15_000 });
          const extracted = extractReadable(page.html, page.finalUrl);
          if (extracted.text.length >= 200 && spec.keywords.test(extracted.text)) {
            found = { url: page.finalUrl, title: extracted.title, text: extracted.text };
            break;
          }
        } catch {
          // 404 or unreadable: keep probing
        }
      }
      // 2. On-domain web search for the topic.
      if (!found && useExa) {
        const query = `${spec.query}`;
        queries.push(query);
        try {
          const res = await exaSearch({ query, includeDomains: [domain], numResults: 5, contents: { text: { maxCharacters: 20_000 } } }, { ...opts.exa, task: "absence_check" });
          for (const r of res.results) {
            if (!isOnDomain(r.url, domain)) continue;
            urlsChecked.push(r.url);
            if (spec.keywords.test(`${r.title ?? ""}\n${r.text ?? ""}`)) {
              found = { url: r.url, title: r.title ?? r.url, text: r.text ?? "" };
              break;
            }
          }
        } catch (e) {
          log(`exa query failed for ${topic}: ${(e as Error).message}`);
        }
      }

      if (found) {
        let snapshotId: number;
        try {
          const r = await createSnapshot(db, { competitorId, url: found.url, sourceType: sourceTypeForPath(new URL(found.url).pathname) === "website" ? spec.sourceType : sourceTypeForPath(new URL(found.url).pathname), provider: "discovery", fetchOptions: { fetchImpl: opts.fetchImpl } });
          snapshotId = r.snapshot.id;
        } catch {
          const text = found.text;
          snapshotId = insertSnapshotRecord(db, competitorId, { url: found.url, sourceType: spec.sourceType, provider: "discovery", title: found.title, publishedAt: now.toISOString().slice(0, 10), fetchedAt: now.toISOString(), archiveUrl: null, rawHtml: "", extractedText: text, contentHash: hashContent(text) }).snapshot.id;
        }
        db.update(schema.sources).set({ watch: true, discoveryQuery: `absence check: ${topic}` }).where(and(eq(schema.sources.competitorId, competitorId), eq(schema.sources.url, found.url))).run();
        // A positive finding retires earlier "not found" records on the topic.
        db.update(schema.absenceChecks)
          .set({ result: "superseded" })
          .where(and(eq(schema.absenceChecks.competitorId, competitorId), eq(schema.absenceChecks.topic, topic), eq(schema.absenceChecks.result, "not_found")))
          .run();
        db.insert(schema.absenceChecks).values({ competitorId, topic, queries, urlsChecked, result: "found", snapshotId, checkedAt: now.toISOString() }).run();
        result.found++;
        log(`${topic}: found at ${found.url} → S${snapshotId} (now watched)`);
      } else {
        const date = now.toISOString().slice(0, 10);
        const run = checkRun(db, competitorId, now);
        const text = [
          `Absence check for ${spec.label} on ${domain}, ${date}.`,
          `Paths probed (${spec.paths.length}): ${spec.paths.map((p) => `${base}${p}`).join(", ")}.`,
          queries.length ? `Web search queries (${queries.length}, limited to ${domain}): ${queries.join(" | ")}.` : "Web search: not run (no search key configured).",
          `URLs examined (${urlsChecked.length}): ${urlsChecked.join(", ") || "none responded"}.`,
          `Result: no page or announcement matching "${spec.keywords.source}" was found.`,
        ].join("\n");
        const { snapshot } = insertSnapshotRecord(db, competitorId, {
          url: `check://${domain}/${topic}`,
          sourceType: "other",
          provider: "discovery",
          title: `Absence check: ${spec.label} (${date})`,
          publishedAt: date,
          fetchedAt: now.toISOString(),
          archiveUrl: null,
          rawHtml: "",
          extractedText: text,
          contentHash: hashContent(text),
        });
        db.update(schema.snapshots).set({ processedRunId: run.id }).where(eq(schema.snapshots.id, snapshot.id)).run();
        const fact = db
          .insert(schema.facts)
          .values({
            runId: run.id,
            competitorId,
            snapshotId: snapshot.id,
            statement: `No ${spec.label} page or announcement was found on ${domain} or in web search as of ${date} (checked: ${spec.paths.length} paths, ${queries.length} queries).`,
            quote: "",
            category: spec.category,
            eventDate: date,
            importance: 3,
            claimKind: "absence",
          })
          .returning()
          .get();
        db.insert(schema.absenceChecks).values({ competitorId, topic, queries, urlsChecked, result: "not_found", snapshotId: snapshot.id, factId: fact.id, checkedAt: now.toISOString() }).run();
        result.notFound++;
        log(`${topic}: not found (${spec.paths.length} paths, ${queries.length} queries) → F${fact.id}`);
      }
    } catch (e) {
      result.errors++;
      log(`${topic}: check failed: ${(e as Error).message}`);
    }
  }
  return result;
}
