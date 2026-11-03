/**
 * robots.txt: one fetch per host per crawl, `User-agent` groups for `*` and
 * our own agent, longest-prefix `Allow`/`Disallow` match. Fetch failures mean
 * "allowed" (the site did not publish rules we could read).
 */
export const ROBOTS_AGENT = "DeltaResearchBot";

export type RobotsGroup = { agents: string[]; allow: string[]; disallow: string[] };
export type RobotsRules = { groups: RobotsGroup[]; sitemaps: string[] };

export function parseRobots(text: string): RobotsRules {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const i = line.indexOf(":");
    if (i === -1) continue;
    const field = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "allow") current.allow.push(value);
    else if (field === "disallow") current.disallow.push(value);
  }
  return { groups, sitemaps };
}

function groupFor(rules: RobotsRules, agent: string): RobotsGroup | undefined {
  const a = agent.toLowerCase();
  return rules.groups.find((g) => g.agents.some((x) => x !== "*" && a.includes(x))) ?? rules.groups.find((g) => g.agents.includes("*"));
}

/** robots.txt patterns: `*` wildcard and `$` end anchor. */
function patternMatches(pattern: string, path: string): boolean {
  if (!pattern) return false;
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp(`^${body.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}${anchored ? "$" : ""}`);
  return re.test(path);
}

export function isAllowed(rules: RobotsRules, url: string, agent = ROBOTS_AGENT): boolean {
  const group = groupFor(rules, agent);
  if (!group) return true;
  let path: string;
  try {
    const u = new URL(url);
    path = `${u.pathname}${u.search}`;
  } catch {
    return false;
  }
  const best = (patterns: string[]) => patterns.filter((p) => patternMatches(p, path)).reduce((n, p) => Math.max(n, p.length), -1);
  const allow = best(group.allow);
  const disallow = best(group.disallow);
  if (disallow === -1) return true;
  // Longest match wins; on a tie Allow wins.
  return allow >= disallow;
}

export class RobotsCache {
  private readonly cache = new Map<string, Promise<RobotsRules>>();
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  rulesFor(url: string): Promise<RobotsRules> {
    const origin = new URL(url).origin;
    let p = this.cache.get(origin);
    if (!p) {
      p = this.load(origin);
      this.cache.set(origin, p);
    }
    return p;
  }

  private async load(origin: string): Promise<RobotsRules> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${origin}/robots.txt`, { signal: controller.signal, redirect: "follow" });
      if (!res.ok) return { groups: [], sitemaps: [] };
      return parseRobots(await res.text());
    } catch {
      return { groups: [], sitemaps: [] };
    } finally {
      clearTimeout(timer);
    }
  }

  async isAllowed(url: string, agent = ROBOTS_AGENT): Promise<boolean> {
    return isAllowed(await this.rulesFor(url), url, agent);
  }
}
