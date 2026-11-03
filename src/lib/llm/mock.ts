import type { LlmClient, LlmRequest, LlmResponse, LlmTask } from "./client";

export type MockHandler = (req: LlmRequest) => unknown;

/**
 * Offline stand-in for any model provider. Returns canned JSON keyed by `task`.
 * Handlers derive output from the request text so downstream checks
 * (verbatim quotes, id references) still pass.
 */
export class MockLlmClient implements LlmClient {
  readonly calls: LlmRequest[] = [];
  private readonly handlers: Partial<Record<LlmTask, MockHandler>>;

  constructor(handlers: Partial<Record<LlmTask, MockHandler>> = {}) {
    this.handlers = { ...defaultHandlers, ...handlers };
  }

  on(task: LlmTask, handler: MockHandler) {
    this.handlers[task] = handler;
    return this;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);
    const handler = this.handlers[req.task];
    if (!handler) throw new Error(`MockLlmClient: no handler for task "${req.task}"`);
    const out = handler(req);
    const content = typeof out === "string" ? out : JSON.stringify(out);
    return { content, usage: { promptTokens: Math.ceil(req.user.length / 4), completionTokens: Math.ceil(content.length / 4) } };
  }
}

/** Text after a marker line in a prompt (used to find page text). */
export function sectionAfter(prompt: string, marker: string): string {
  const i = prompt.indexOf(marker);
  return i === -1 ? prompt : prompt.slice(i + marker.length).trim();
}

/** First `n` sentences of a text, as verbatim quotes. */
export function firstSentences(text: string, n: number): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.split(" ").length >= 8)
    .slice(0, n);
}

const ids = (prompt: string, prefix: string): number[] =>
  Array.from(new Set(Array.from(prompt.matchAll(new RegExp(`\\b${prefix}(\\d+)\\b`, "g")), (m) => Number(m[1]))));

const runLabel = (prompt: string) => prompt.match(/# This run: (Run \d+)/)?.[1] ?? "Run 1";

export const defaultHandlers: Partial<Record<LlmTask, MockHandler>> = {
  smoke: () => ({ ok: true }),

  /** No rewrites: the digest keeps the pipeline's wording, so tests see the same text they seeded. */
  write_digest: () => ({ intro: "", insights: [], theories: [], changes: [], questions: [] }),

  /** Onboarding drafts derive from the site name in the prompt so tests can assert the shape. */
  draft_company: (req) => {
    const name = req.user.match(/Domain: ([^\n]+)/)?.[1]?.split(".")[0] ?? "Company";
    const conf = { description: 0.8, product: 0.7, targetCustomers: 0.6, positioning: 0.5, priorities: 0.3, constraints: 0.2 };
    return {
      name: name.charAt(0).toUpperCase() + name.slice(1),
      description: `Mock: ${name} is a small SaaS company drafted from its website.`,
      product: "Mock: a scheduling and reporting product.",
      targetCustomers: "Mock: small agencies and freelancers.",
      positioning: "Mock: organised around clients, not channels.",
      priorities: "Mock hypothesis: win small agencies; keep pricing simple.",
      constraints: "Mock hypothesis: small team, self-serve only.",
      fieldConfidence: conf,
      clarifyingQuestions: [
        { question: "How many people are on the team, and how many are engineers?", whyItMatters: "Constrains which responses are realistic.", field: "constraints" },
        { question: "Which customer segment pays the most today?", whyItMatters: "Decides which competitor moves matter.", field: "targetCustomers" },
        { question: "What will you not do, even if a competitor does it?", whyItMatters: "Keeps recommendations credible.", field: "priorities" },
      ],
    };
  },
  draft_competitor: (req) => {
    const domain = req.user.match(/Domain: ([^\n]+)/)?.[1] ?? "competitor.example";
    const name = domain.split(".")[0];
    const dim = (text: string) => ({ text: `Mock: ${text}`, confidence: 0.6 });
    const urls = Array.from(req.user.matchAll(/^- (https?:\/\/[^\s]+)/gm), (m) => m[1]);
    return {
      name: name.charAt(0).toUpperCase() + name.slice(1),
      description: `Mock: ${name} drafted from its site.`,
      domain,
      profile: { segments: dim("agencies and SMBs"), pricingModel: dim("per channel"), positioning: dim("simple"), distribution: dim("self-serve"), notable: dim("partner program") },
      suggestedWatchlist: urls.slice(0, 5).map((url) => ({ url, sourceType: /pric|plan/.test(url) ? "pricing" : "website", reason: "Mock: commercial page", watch: true })),
      feeds: [],
      researchQuestions: [
        "Which segments are they targeting, given our priority to win small agencies?",
        "How is their pricing and packaging changing, and does it threaten our simple pricing?",
        "Which capabilities are they prioritising?",
        "How are they acquiring customers: partners, content or product-led?",
        "What do their recent moves suggest about their next moves?",
      ],
      emphasisQuestion: "Is there one aspect of this competitor you want Delta to watch most closely?",
    };
  },

  /** A candidate is about the competitor when its name appears in the page excerpt. */
  assess_relevance: (req) => {
    const name = req.system.match(/competitor named "([^"]+)"/)?.[1] ?? "";
    const excerpt = sectionAfter(req.user, "=== CANDIDATE ===");
    const about = name !== "" && excerpt.toLowerCase().includes(name.toLowerCase());
    return { aboutCompetitor: about, relevant: about, reason: about ? `Mock: mentions ${name}` : "Mock: does not mention the competitor", sourceType: /pric/i.test(excerpt) ? "pricing" : "press" };
  },

  /**
   * Deterministic arc for tests: Run 1 creates a hypothesis, Run 2 strengthens
   * it, Run 3 revises it. New facts are the F ids after the "NEW facts" header.
   */
  synthesize: (req) => {
    const newSection = sectionAfter(req.user, "## NEW facts extracted");
    const factIds = ids(newSection, "F");
    const hypIds = ids(sectionAfter(req.user, "## Current hypotheses").split("## Open research")[0], "H");
    const label = runLabel(req.user);
    const date = req.user.match(/\[(\d{4}-\d{2}-\d{2})\] \[/)?.[1] ?? "2023-01-01";
    const profileDim = (summary: string) => ({ summary, confidence: 0.5, factIds: factIds.slice(0, 2) });
    let hypothesisUpdates: unknown[];
    if (hypIds.length === 0) {
      hypothesisUpdates = [
        { hypothesisId: null, dimension: "customers", statement: "Mock: the competitor is investing in agencies as a segment", change: "created", claimKind: "positive", confidence: 0.5, reasoning: "Mock reasoning: created from the first facts.", factIds },
      ];
    } else if (label === "Run 2") {
      hypothesisUpdates = [
        { hypothesisId: hypIds[0], dimension: "customers", statement: "Mock: the competitor is investing in agencies as a segment", change: "strengthened", claimKind: "positive", confidence: 0.7, reasoning: "Mock reasoning: more agency evidence.", factIds },
      ];
    } else {
      hypothesisUpdates = [
        { hypothesisId: hypIds[0], dimension: "customers", statement: "Mock: the competitor dropped the dedicated agency tier and serves agencies through per-channel pricing", change: "revised", claimKind: "positive", confidence: 0.6, reasoning: "Mock reasoning: pricing page no longer lists the plan.", factIds },
      ];
    }
    return {
      timelineEvents: factIds.length ? [{ eventDate: date, title: `Mock event for ${label}`, summary: "Mock summary of what happened.", factIds: factIds.slice(0, 2), relatedEventIds: ids(req.user, "E").slice(0, 1) }] : [],
      hypothesisUpdates,
      strategyProfile: {
        customers: profileDim("Mock customers"),
        productDirection: profileDim("Mock product direction"),
        positioning: profileDim("Mock positioning"),
        distribution: profileDim("Mock distribution"),
        businessModel: profileDim("Mock business model"),
      },
      conflicts: [],
      openQuestions: { resolved: ids(req.user, "Q").slice(0, 1).map((id) => ({ id, resolution: "Mock: answered by this run." })), new: [{ question: `Mock question raised in ${label}: what does the next pricing capture show?` }] },
    };
  },

  generate_insights: (req) => {
    const factIds = ids(sectionAfter(req.user, "## New facts this run"), "F");
    const hypIds = ids(sectionAfter(req.user, "## Hypotheses after this run").split("## Insights already on record")[0], "H");
    // Later runs update the first insight on record instead of restating it.
    const priorInsightIds = ids(sectionAfter(req.user, "## Insights already on record").split("## New timeline events")[0], "I");
    return {
      insights: [
        {
          updatesInsightId: priorInsightIds[0] ?? null,
          relevance: 4,
          relevanceNote: "Mock: touches priority 1 (win small agencies)",
          actionability: 3,
          title: `Mock insight for ${runLabel(req.user)}`,
          whatHappened: "Mock: the competitor changed its pricing page.",
          whatItMeans: "Mock: this suggests a shift in segment focus.",
          whyItMatters: "Mock: it affects our agency segment priority.",
          whatToDoNext: "Mock: interview five agency customers about plan requirements.",
          severity: "high",
          hypothesisIds: hypIds.slice(0, 1),
          factIds: factIds.slice(0, 2),
          actions: [{ type: "investigate", text: "Mock: run interviews", rationale: "Mock rationale" }],
        },
      ],
    };
  },

  extract_facts: (req) => {
    const text = sectionAfter(req.user, "=== PAGE TEXT ===");
    const date = req.user.match(/Published \/ captured: (\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
    const facts = firstSentences(text, 3).map((quote, i) => ({
      statement: `Mock fact ${i + 1}: ${quote.slice(0, 60)}`,
      quote,
      category: i === 0 ? "pricing" : "product",
      eventDate: date,
      importance: 3,
      billingCadence: i === 0 ? "monthly" : null,
      availability: i === 0 ? null : "shipped",
    }));
    return { facts };
  },

  detect_change: (req) => {
    const added = sectionAfter(req.user, "=== LINES ONLY IN THE CURRENT VERSION (added) ===").split("=== CURRENT VERSION")[0];
    const prevDate = req.user.match(/Previous capture date: (\d{4}-\d{2}-\d{2})/)?.[1];
    const curDate = req.user.match(/Current capture date: (\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
    const [quote] = firstSentences(added, 1);
    if (!quote) return { changes: [] };
    return {
      changes: [
        {
          statement: `Between ${prevDate} and ${curDate} the page changed: ${quote.slice(0, 60)}`,
          quote,
          category: "pricing",
          eventDate: curDate,
          importance: 4,
          billingCadence: "monthly",
          availability: null,
        },
      ],
    };
  },
};
