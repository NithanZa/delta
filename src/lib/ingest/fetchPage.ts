export class FetchError extends Error {
  constructor(
    message: string,
    public readonly url: string,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

export type FetchPageOptions = {
  /** Wayback Machine timestamp (YYYYMMDDhhmmss). When set, the archived capture is fetched. */
  archiveTimestamp?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export type FetchedPage = { html: string; finalUrl: string; archiveUrl: string | null; fetchedAt: string };

const USER_AGENT = "Mozilla/5.0 (compatible; DeltaResearchBot/0.1; +https://github.com/delta)";
const MIN_HTML_CHARS = 500;

export function archiveUrlFor(url: string, timestamp: string): string {
  // The `id_` flag returns the original HTML without the Wayback toolbar.
  return `https://web.archive.org/web/${timestamp}id_/${url}`;
}

/** Fetch a page (live or archived) and return its HTML. Throws FetchError with a readable message. */
export async function fetchPage(url: string, opts: FetchPageOptions = {}): Promise<FetchedPage> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const archiveUrl = opts.archiveTimestamp ? archiveUrlFor(url, opts.archiveTimestamp) : null;
  const target = archiveUrl ?? url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);

  let res: Response;
  try {
    res = await fetchImpl(target, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
    });
  } catch (e) {
    const reason = (e as Error).name === "AbortError" ? "timed out" : (e as Error).message;
    throw new FetchError(`Could not fetch ${target}: ${reason}`, url);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new FetchError(`Could not fetch ${target}: HTTP ${res.status}`, url);

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType && !/html|xml|text\/plain/i.test(contentType)) {
    throw new FetchError(`Not an HTML page (${contentType.split(";")[0]}): ${target}`, url);
  }

  const html = await res.text();
  if (html.length < MIN_HTML_CHARS) {
    throw new FetchError(`Page returned almost no HTML (${html.length} chars); it is probably rendered by JavaScript: ${target}`, url);
  }

  // Wayback redirects inexact timestamps to the nearest capture; keep the resolved URL.
  const resolvedArchiveUrl = archiveUrl ? res.url || archiveUrl : null;
  return { html, finalUrl: res.url || target, archiveUrl: resolvedArchiveUrl, fetchedAt: new Date().toISOString() };
}
