import type { LlmClient, LlmRequest, LlmResponse, LlmTask } from "./client";

export type MockHandler = (req: LlmRequest) => unknown;

/**
 * Offline stand-in for StepFun. Returns canned JSON keyed by `task`.
 * Later phases register handlers that derive output from the request text so
 * downstream checks (verbatim quotes, id references) still pass.
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
    return { content, usage: { promptTokens: req.user.length / 4, completionTokens: content.length / 4 } };
  }
}

export const defaultHandlers: Partial<Record<LlmTask, MockHandler>> = {
  smoke: () => ({ ok: true }),
};
