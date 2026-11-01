import fs from "node:fs";

// Next.js loads .env.local itself; CLI scripts run through tsx do not.
if (!process.env.STEPFUN_API_KEY && fs.existsSync(".env.local")) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // ignore: fall through to defaults below
  }
}

export const env = {
  stepfunApiKey: process.env.STEPFUN_API_KEY ?? "",
  stepfunBaseUrl: process.env.STEPFUN_BASE_URL ?? "https://api.stepfun.ai/v1",
  dbPath: process.env.DELTA_DB_PATH ?? "data/delta.db",
  mockLlm: process.env.DELTA_MOCK_LLM === "1",
};
