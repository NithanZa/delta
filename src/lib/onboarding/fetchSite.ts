/**
 * Read enough of a company's own site to draft a profile: the home page plus
 * the commercial pages the watchlist probe finds, in priority order.
 */
import { extractReadable } from "@/lib/ingest/extract";
import { fetchPage } from "@/lib/ingest/fetchPage";
import { assertPublicHttpUrl } from "@/lib/ingest/safeUrl";
import { proposeWatchlist, type WatchlistProposal } from "@/lib/ingest/watchlist";

export type SitePage = { url: string; title: string; text: string };
export type SiteRead = { domain: string; website: string; pages: SitePage[]; proposal: WatchlistProposal };

export const PAGE_TEXT_CAP = 8000;
const PRIORITY: RegExp[] = [/^\/(pricing|plans)/, /^\/(product|features)/, /^\/(customers|case-studies|resources\/case-studies)/, /^\/about/, /^\/solutions/, /^\/(blog|resources)\/?$/];

/** Order pages by how much they say about the business: pricing first, blog index last, the rest in between. */
export function prioritise(urls: string[]): string[] {
  const rank = (u: string) => {
    const path = new URL(u).pathname;
    if (path === "/" || path === "") return -1;
    const i = PRIORITY.findIndex((re) => re.test(path));
    return i === -1 ? PRIORITY.length : i;
  };
  return [...urls].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export async function readSite(website: string, opts: { maxPages?: number; fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<SiteRead> {
  const url = assertPublicHttpUrl(/^https?:\/\//i.test(website) ? website : `https://${website}`);
  const maxPages = opts.maxPages ?? 7;
  const proposal = await proposeWatchlist(url.toString(), { fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs });
  const candidates = prioritise([url.toString(), ...proposal.pages.map((p) => p.url)]);
  const pages: SitePage[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (pages.length >= maxPages) break;
    const key = candidate.replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    const known = proposal.pages.find((p) => p.url.replace(/\/$/, "") === key);
    if (known?.text) {
      pages.push({ url: known.url, title: known.title, text: known.text.slice(0, PAGE_TEXT_CAP) });
      continue;
    }
    try {
      const page = await fetchPage(candidate, { fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs ?? 15_000 });
      const extracted = extractReadable(page.html, page.finalUrl);
      if (extracted.text.length < 200) continue;
      pages.push({ url: page.finalUrl, title: extracted.title, text: extracted.text.slice(0, PAGE_TEXT_CAP) });
    } catch {
      // unreadable page: skip
    }
  }
  if (pages.length === 0) throw new Error(`Could not read any page on ${url.hostname} (the site may block crawlers or render only with JavaScript)`);
  return { domain: proposal.domain, website: url.toString(), pages, proposal };
}
