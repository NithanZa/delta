import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["src/**/*.test.ts", "eval/**/*.test.ts"],
    env: { DELTA_MOCK_LLM: "1", DELTA_DB_PATH: ":memory:" },
  },
});
