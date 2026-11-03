# Deploying Delta

One small VPS runs three containers: the web app, the worker and Caddy (automatic TLS and a password in front of the dashboard). Everything is configured by one `.env`. Data lives in `./data` on the host.

## What you need

- A VPS with Docker and Compose. 2 vCPU, 2 GB RAM and 20 GB disk is enough for a few competitors.
- A domain you control.
- API keys: a model provider (Anthropic, or any OpenAI-compatible endpoint), Resend for email, and optionally Exa for discovery.

## 1. DNS

- `A` record for your dashboard host, e.g. `delta.example.com`, pointing at the VPS. Caddy obtains the certificate once this resolves.
- In Resend, verify a sending domain, e.g. `notify.example.com`, by adding the records it shows you.
- A send-only Resend key is enough. Readers send notes through a signed link in the digest, so this domain doesn't need to receive email.

## 2. Configure

```bash
git clone <this repo> delta && cd delta
cp .env.example .env
```

Fill in `.env` (each variable is documented in the file). At minimum:

```bash
DELTA_HOST=delta.example.com
DELTA_BASE_URL=https://delta.example.com
DELTA_LINK_SECRET=<openssl rand -base64 32>
DELTA_BASIC_USER=delta
DELTA_BASIC_HASH='<see below>'
ANTHROPIC_API_KEY=...
RESEND_API_KEY=...
DELTA_DIGEST_FROM="Delta <delta@notify.example.com>"
TZ=Europe/London
```

Create the password hash. Keep it in **single quotes** in `.env`, because bcrypt hashes contain `$`:

```bash
docker run --rm caddy:2 caddy hash-password --plaintext 'your-password'
```

## 3. Start

```bash
docker compose up -d --build
docker compose exec web npm run doctor
```

`doctor` checks the database, both models, Exa, Resend and the base URL, and says what is missing. Add `-- --send-test` to send one email from your From address to Resend's test inbox, which proves the key and the domain work without emailing anyone.

`https://<host>/` should ask for the password. These stay public: `/r/*` (signed reaction and note links), `/api/health`, `/about-bot` and `/_next/static/*`.

## 4. Set up the partner

Open `https://<host>/onboarding`:

1. Enter the partner's website and answer the clarifying questions.
2. Add each competitor from its URL and accept the proposed watchlist and feeds.
3. Set the digest recipients, the sender, the reply domain and your ops email. Optionally start a crawl, discovery and the 24-month backfill.

Check the worker on `/ops`: the dot is green when its heartbeat is under three minutes old.

## Updating

```bash
git pull && docker compose build && docker compose up -d
```

Migrations run when the containers open the database.

## Backups and restore

The worker writes `data/backups/delta-<timestamp>.db` daily at 02:00 and keeps 14. Copy them off the box, for example with cron:

```bash
rclone copy data/backups remote:delta-backups
```

To restore:

```bash
docker compose stop worker web
cp data/backups/delta-<timestamp>.db data/delta.db
rm -f data/delta.db-wal data/delta.db-shm
docker compose up -d
```

## Logs

```bash
docker compose logs -f worker
docker compose logs -f web
```

Job failures are also kept in `jobs.error` and shown on `/ops`. A held or failed digest emails `ops.email`.

## Known limitations

- SQLite means one host. Web and worker share `./data`, so both containers must run on the same machine and filesystem.
- If the VPS reboots or the worker is stopped during a job, it recovers on start: an interrupted scheduled run starts again, a backfill resumes at its first unfinished cutoff, and other jobs are marked failed and run on their next schedule. A run started from the dashboard is marked failed after 20 minutes without progress.
- `docker compose stop` gives the worker 60 seconds to finish its job. Real runs take longer, so they are interrupted and re-queued rather than finished. That is safe, and costs only the model calls already made for that run.
- The URL guard refuses private and local addresses as written. It does not resolve DNS or re-check redirects, so the dashboard password remains the real boundary against someone pointing Delta at an internal host.
- Tokens signed with `DELTA_LINK_SECRET` stop working if you change it, so older digest links will show as invalid.
