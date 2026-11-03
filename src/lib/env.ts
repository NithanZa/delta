import fs from "node:fs";

// Next.js loads .env.local itself; CLI scripts run through tsx do not.
const anyKey = ["ANTHROPIC_API_KEY", "OPENAI_COMPAT_API_KEY", "STEPFUN_API_KEY"].some((k) => process.env[k]);
if (!anyKey && fs.existsSync(".env.local")) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // ignore: fall through to defaults below
  }
}

export const env = {
  // Models per role, as provider:model (see src/lib/llm/config.ts for defaults and fallbacks).
  llmExtract: process.env.LLM_EXTRACT,
  llmSynth: process.env.LLM_SYNTH,
  llmExtractEffort: process.env.LLM_EXTRACT_EFFORT,
  llmSynthEffort: process.env.LLM_SYNTH_EFFORT,
  llmReasoningEffortModels: process.env.LLM_REASONING_EFFORT_MODELS,
  llmOpenaiTemperature: process.env.LLM_OPENAI_TEMPERATURE,
  llmPricesJson: process.env.LLM_PRICES_JSON,
  // Provider credentials. STEPFUN_* are accepted as aliases so existing .env.local files keep working.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  openaiCompatBaseUrl: process.env.OPENAI_COMPAT_BASE_URL ?? process.env.STEPFUN_BASE_URL ?? "https://api.stepfun.ai/v1",
  openaiCompatApiKey: process.env.OPENAI_COMPAT_API_KEY ?? process.env.STEPFUN_API_KEY ?? "",
  // Public base URL of this instance (links, webhooks, the crawler's contact page).
  baseUrl: (process.env.DELTA_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
  dbPath: process.env.DELTA_DB_PATH ?? "data/delta.db",
  // Signs reaction links in digests (openssl rand -base64 32). A fixed dev default keeps local links working.
  linkSecret: process.env.DELTA_LINK_SECRET ?? "dev-only-change-me",
  // Default From for digests until one is saved in Settings, e.g. "Delta <delta@notify.example.com>".
  digestFrom: process.env.DELTA_DIGEST_FROM ?? "",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  exaApiKey: process.env.EXA_API_KEY ?? "",
  mockLlm: process.env.DELTA_MOCK_LLM === "1",
};
