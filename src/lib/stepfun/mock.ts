import type { LlmClient, LlmRequest, LlmResponse, LlmTask } from "./client";

export type MockHandler = (req: LlmRequest) => unknown;

/**
 * Offline stand-in for StepFun. Returns canned JSON keyed by `task`.
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

export const defaultHandlers: Partial<Record<LlmTask, MockHandler>> = {
  smoke: () => ({ ok: true }),

  extract_facts: (req) => {
    const text = sectionAfter(req.user, "=== PAGE TEXT ===");
    const date = req.user.match(/Published \/ captured: (\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
    const facts = firstSentences(text, 3).map((quote, i) => ({
      statement: `Mock fact ${i + 1}: ${quote.slice(0, 60)}`,
      quote,
      category: i === 0 ? "pricing" : "product",
      eventDate: date,
      importance: 3,
    }));
    return { facts };
  },

  detect_change: (req) => {
    const current = sectionAfter(req.user, "=== CURRENT VERSION ===");
    const prevDate = req.user.match(/Previous capture date: (\d{4}-\d{2}-\d{2})/)?.[1];
    const curDate = req.user.match(/Current capture date: (\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
    const [quote] = firstSentences(current, 1);
    if (!quote) return { changes: [] };
    return {
      changes: [
        {
          statement: `Between ${prevDate} and ${curDate} the page changed: ${quote.slice(0, 60)}`,
          quote,
          category: "pricing",
          eventDate: curDate,
          importance: 4,
        },
      ],
    };
  },
};
