import fs from "node:fs";
import path from "node:path";
import type { Competitor, Provider, SourceType } from "@/db/schema";

/** A page a provider proposes for ingestion. */
export type SourceCandidate = {
  url: string;
  sourceType: SourceType;
  provider: Provider;
  publishedAt?: string;
  archiveTimestamp?: string;
  title?: string;
  note?: string;
};

export interface SourceProvider {
  readonly id: Provider;
  discover(competitor: Pick<Competitor, "slug" | "website">): Promise<SourceCandidate[]>;
}

export type ManifestEntry = {
  url: string;
  sourceType: SourceType;
  publishedAt: string;
  archiveTimestamp?: string;
  title?: string;
  note?: string;
};

export function corpusDir(slug: string): string {
  return path.resolve(process.cwd(), "data", "corpus", slug);
}

export function readManifest(slug: string): ManifestEntry[] {
  const file = path.join(corpusDir(slug), "manifest.json");
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf8")) as ManifestEntry[];
}

/** Curated, dated pages listed in data/corpus/{slug}/manifest.json. */
export class SeededProvider implements SourceProvider {
  readonly id = "seeded" as const;
  async discover(competitor: Pick<Competitor, "slug">): Promise<SourceCandidate[]> {
    return readManifest(competitor.slug).map((e) => ({ ...e, provider: "seeded" as const }));
  }
}

/** A single URL the user pasted in. */
export class ManualUrlProvider implements SourceProvider {
  readonly id = "manual_url" as const;
  constructor(
    private readonly url: string,
    private readonly sourceType: SourceType,
  ) {}
  async discover(): Promise<SourceCandidate[]> {
    return [{ url: this.url, sourceType: this.sourceType, provider: "manual_url" }];
  }
}

/** Extension point for Tavily/Exa/Brave. Not implemented in the MVP. */
export class SearchProvider implements SourceProvider {
  readonly id = "search" as const;
  async discover(): Promise<SourceCandidate[]> {
    throw new Error("SearchProvider is not implemented yet. Add a search API behind this interface.");
  }
}
