import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page reads SQLite at request time; the Cache Components model adds
  // Suspense requirements this local-first app does not need.
  cacheComponents: false,
  partialPrefetching: false,
  serverExternalPackages: ["better-sqlite3", "jsdom"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
