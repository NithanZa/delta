# Delta prototype

## Outcome

`docker compose up -d` on a small VPS runs the web app, the worker and a Caddy reverse proxy with automatic TLS. The dashboard is behind a proxy password; reaction links, the Resend webhook and the health endpoint are public. Data lives on a bind-mounted volume with nightly backups. Everything is configured by one `.env`, and `docs/deploy.md` takes a stranger from a fresh VPS to the first digest.

## Step-by-step

1. **Dockerfile** (multi-stage, `node:22-bookworm-slim`):
   - `deps`: `apt-get install -y python3 make g++ ca-certificates` (needed only if `better-sqlite3` has to compile; the prebuilt linux-x64 glibc binary normally downloads), `COPY package.json`, `npm ci` (no `package-lock.json` is committed today — commit one now so builds are reproducible; `.npmrc` stays).
   - `build`: copy source, `npm run build` (Next 16 builds with Turbopack by default; `serverExternalPackages` for `better-sqlite3` and `jsdom` already set in `next.config.ts`).
   - `runtime`: copy `node_modules`, `.next`, `public`, `src`, `scripts`, `drizzle`, `data/seed`, `data/corpus`, `eval`, `package.json`, `tsconfig.json`; `ENV NODE_ENV=production`; `EXPOSE 3000`; `CMD ["npm","run","start"]`. The worker uses the same image with `command: ["npx","tsx","scripts/worker.ts"]` (tsx is a devDependency today → move `tsx` to `dependencies`). `output: 'standalone'` is not used so the worker can run from source in the same image.
   - `.dockerignore`: `node_modules`, `.next`, `data/*.db*`, `data/backups`, `.env*`, `dist`, `docs/screenshots`.

2. **docker-compose.yml**: services `web` (build `.`, `env_file: .env`, `volumes: ["./data:/app/data"]`, `expose: ["3000"]`, `restart: unless-stopped`, healthcheck `curl -f http://localhost:3000/api/health`), `worker` (same image, same env and volume, `depends_on: web`, `restart: unless-stopped`, `stop_grace_period: 60s`), `caddy` (`caddy:2`, `ports: ["80:80","443:443"]`, `./Caddyfile`, volumes `caddy_data`, `caddy_config`). SQLite in WAL mode is shared between the two containers through the same host directory (same filesystem, so file locks work); `busy_timeout` is already 10 s in `src/db/index.ts`.

3. **Caddyfile**:
   ```
   {$DELTA_HOST} {
     @public path /r/* /api/webhooks/* /api/health
     handle @public { reverse_proxy web:3000 }
     handle {
       basic_auth { {$DELTA_BASIC_USER} {$DELTA_BASIC_HASH} }
       reverse_proxy web:3000 { flush_interval -1 }
     }
   }
   ```
   `DELTA_BASIC_HASH` from `docker run --rm caddy:2 caddy hash-password --plaintext '<pw>'`. `flush_interval -1` keeps the NDJSON run stream unbuffered. Caddy obtains the certificate automatically once the DNS A record points at the VPS.

4. **Health** `src/app/api/health/route.ts`: `SELECT 1`, worker heartbeat age (< 3 min), last digest status; 200 with JSON or 503.

5. **Env** `.env.example` (complete, commented): `DELTA_BASE_URL` (public https URL used in links and webhooks), `DELTA_LINK_SECRET`, `DELTA_DB_PATH=data/delta.db`, `TZ`, `LLM_EXTRACT`, `LLM_SYNTH`, `ANTHROPIC_API_KEY`, `OPENAI_COMPAT_BASE_URL`/`OPENAI_COMPAT_API_KEY` (optional), `EXA_API_KEY`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `DELTA_HOST`, `DELTA_BASIC_USER`, `DELTA_BASIC_HASH`. Settings that live in the DB (`digest.to`, schedule) are set through the UI after first boot.

6. **First boot**: `createDb()` migrates automatically; the home page's empty state links to `/onboarding` (phase 9). Add `npm run doctor` (`scripts/doctor.ts`) that checks env presence, DB write, model smoke (`llm:smoke`), Exa key, Resend key (list domains), and prints what is missing.

7. **Backups**: the phase-5 `backup` job runs daily; `docs/deploy.md` adds an `rclone`/`scp` line for off-box copies and the restore procedure (`docker compose stop worker web`, copy file over `data/delta.db`, remove `-wal/-shm`, start).

8. **Logging and errors**: stdout with ISO timestamps from both processes (`docker compose logs -f worker`); job failures persist in `jobs.error`; the digest job emails `ops.email` on `held`/`failed`.

9. **Security basics**: secrets only in `.env` (never in the image); `/r/*` tokens expire; webhook signature verified; `/api/sources` and onboarding fetchers refuse private IPs and `localhost`; Caddy's `basic_auth` covers everything else including `/api/runs` and `/ops`; no `NEXT_PUBLIC_*` secrets.

10. **docs/deploy.md**: VPS sizing (2 vCPU / 2 GB / 20 GB is enough), DNS (A record for `DELTA_HOST`; Resend MX on a separate subdomain for replies), Resend domain verification, Exa and Anthropic keys, `git clone`, `.env`, `docker compose up -d --build`, `npm run doctor` inside the web container, onboarding URL, updating (`git pull && docker compose build && docker compose up -d`), backups and restore, log locations, and the known limitation that a VPS reboot during a run marks it failed after 20 minutes and the next schedule retries.

11. **Rehearsal on the VPS**: deploy, run `doctor`, onboard Loop + Buffer through `/onboarding`, trigger crawl, run and digest from `/ops`, receive the email in your own inbox, click a reaction, reply with a URL, confirm the inbound shows as processed and the next run cites it.

## API notes (verified 2026-11-02)

- Next.js 16 self-hosting: a reverse proxy in front of `next start` is recommended; `after()` is fully supported with `next start`; on `SIGINT`/`SIGTERM` the server finishes in-flight requests and pending `after()` callbacks, so give it a 10–30 s drain (`stop_grace_period`). Streaming responses need the proxy not to buffer (Caddy `flush_interval -1`; nginx would need `X-Accel-Buffering: no`). `PORT` and `HOSTNAME` env vars are honoured by `next start`. `output: 'standalone'` would produce `.next/standalone/server.js` plus manual copies of `public` and `.next/static`; not used here.
- Node ≥ 20.9 and TypeScript ≥ 5.1 are required by Next 16; the image uses Node 22.
- Caddy `basic_auth` requires a bcrypt hash produced by `caddy hash-password`; matchers (`@public path …`) exempt routes.

## Acceptance criteria

- [x] AC1 (skipped by Nithan on 2026-11-03: no VPS or DNS; the full stack verified locally through Caddy on localhost with its internal CA): On a fresh VPS with DNS set, `docker compose up -d --build` results in `https://<DELTA_HOST>/` prompting for the basic-auth password, `https://<DELTA_HOST>/api/health` returning 200 without a password, and a valid TLS certificate.
- [x] AC2 (heartbeat verified in a container; a cron tick firing verified by a test with a one-second pattern, not at the configured time): The worker container's heartbeat shows green on `/ops` and a scheduled crawl runs at the configured time (check `jobs`).
- [x] AC3 (skipped by Nithan: doctor ran inside the web container with DB, both models and base URL checks working; Resend and Exa report missing keys): `npm run doctor` inside the `web` container reports every integration as OK (model, Exa, Resend, DB write, base URL).
- [x] AC4 (verified locally through Caddy: reaction link and webhook reachable without a password, dashboard not. Skipped by Nithan: from the public internet): A reaction link and the Resend webhook work from the public internet without a password; the dashboard does not.
- [x] AC5 (backup job and documented restore verified in containers. Skipped by Nithan: observing the 02:00 tick on a host): `data/backups/` receives a nightly file; the documented restore procedure restores a backup and the app starts.
- [x] AC6 (skipped by Nithan: needs a second person and a second VPS): `docs/deploy.md` is followed by a second person (or by you on a second VPS) from zero to a received digest without consulting anything else.
