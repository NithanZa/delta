# One image for both processes: `web` runs `next start`, `worker` runs scripts/worker.ts from source.
# output: 'standalone' is deliberately not used, so the worker can run from the same tree.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# .npmrc keeps install scripts off: better-sqlite3 uses its bundled prebuilt binary, so no toolchain is needed.
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/eval ./eval
COPY --from=build /app/package.json /app/tsconfig.json /app/next.config.ts ./
# Fallback for a run without the ./data bind mount. With it, these come from the git checkout on the host.
COPY --from=build /app/data/seed ./data/seed
COPY --from=build /app/data/corpus ./data/corpus
EXPOSE 3000
CMD ["node_modules/.bin/next", "start"]
