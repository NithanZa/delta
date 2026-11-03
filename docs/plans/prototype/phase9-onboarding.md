# Delta prototype

## Outcome

A design partner is set up from two URLs. Delta reads the partner's own site and drafts the company profile (product, customers, positioning, priorities, constraints), then asks three to five clarifying questions whose answers the site cannot reveal. For each competitor it reads the site, drafts the profile, proposes a watchlist with reasons and five research questions tuned to the partner's priorities, and asks one question about emphasis. Everything lands in the existing tables and stays editable in Settings. The hand-authored `data/seed` files are no longer the only way in.

## Step-by-step

1. **Schema** (`drizzle-kit generate --name onboarding`): `company` add `website` text, `onboarding` JSON (`{ draftedAt, sourceUrls: string[], questions: [{ question, whyItMatters, field, answer }] }`); `competitors` add `profile` JSON (`{ segments, pricingModel, positioning, distribution, notable }` with per-field confidence), `emphasis` text, `onboarded_at`.

2. **Site reader** `src/lib/onboarding/fetchSite.ts`: `readSite(url, { maxPages: 7, fetchImpl })` → home page plus pages picked from `proposeWatchlist()` (phase 4) in priority order `/pricing|/plans`, `/product|/features`, `/customers|/case-studies`, `/about`, `/solutions`, first blog index; each via `fetchPage` + `extractReadable`, text capped at 8000 chars; returns `{ domain, pages: [{ url, title, text }] }`. Reuses the robots and politeness code from phase 4.

3. **Company draft** `src/lib/onboarding/draftCompany.ts` (`synthesize` role, structured output): schema `{ name, description, product, targetCustomers, positioning, priorities, constraints, fieldConfidence: Record<field, 0–1>, clarifyingQuestions: [{ question, whyItMatters, field }] }` (3–5 questions). Prompt: draft only what the pages support, mark low confidence where the site is silent, write priorities and constraints as hypotheses to confirm, and ask questions that only the team can answer (team size and engineering capacity, what they will not do, which segment pays, pricing posture, the one competitor move that would hurt most). Output must not invent customer counts or funding.

4. **Competitor draft** `src/lib/onboarding/draftCompetitor.ts`: input = company profile + competitor pages + the proposal from `proposeWatchlist` (titles only) → `{ name, description, domain, profile, suggestedWatchlist: [{ url, sourceType, reason, watch: boolean }], feeds: [{ url, kind }], researchQuestions: string[5], emphasisQuestion: string }`. Research questions must reference the company's stated priorities (as the seed questions for Buffer do) and cover segments, pricing/packaging, capabilities, distribution, next moves.

5. **UI** `src/app/onboarding/page.tsx` as a three-step server-rendered flow with server actions and `useActionState` (same pattern as `src/app/settings/forms.tsx`):
   - Step 1 "Your company": URL input → `draftCompanyAction` (runs `readSite` + `draftCompany`, shows a progress note; typical 30–60 s) → form prefilled with the draft, each field with a confidence hint, followed by the clarifying questions as textareas → `saveCompanyAction` writes `company` and appends answers to the matching field as `Clarified: <answer>` lines, storing the Q&A in `onboarding`.
   - Step 2 "Competitors": URL input → `draftCompetitorAction` → review form: name/description/profile, watchlist checkboxes (pre-checked per `watch`), feeds, research questions (one per line), emphasis textarea → `createCompetitorAction` inserts the competitor (`domain`, `profile`, `emphasis`), sources with `watch = true` and `provider = 'watchlist'`, feeds, research questions; repeat for more competitors.
   - Step 3 "Delivery": digest recipients, timezone, schedule preview, optional "Backfill 24 months" (phase 10) and "Run discovery now" buttons; "Finish" → home. Link to `/onboarding` from the home page empty state and from Settings ("Add competitor from URL"). Settings gets "Re-draft from website" buttons that reuse the drafters and prefill the forms without saving.

6. **Validation and safety**: `z.string().url()` on inputs; `readSite` refuses non-http(s), private IPs and `localhost` (SSRF guard shared with `/api/sources`); drafts are never saved without the user pressing save; failures (site blocks bots, JS-only) show a readable message and let the user fill the form manually.

7. **Seed parity**: `scripts/seed.ts` continues to work; add `data/seed/company.json` `website` and keep Loop as the rehearsal partner (phase 12).

8. **Tests**: drafters with the mock client (schema shape, 3–5 questions, five research questions); `readSite` with `fetchImpl` (page selection order, caps, SSRF guard); actions validation; an integration test that runs step 1 and 2 with the mock and asserts the resulting rows (company, competitor with domain, watched sources, feeds, questions).

## Acceptance criteria

- [x] AC1 (verified live with https://www.sendible.com on StepFun: 7 fields, 5 questions, 40 s): Entering `https://www.getloop.example` (any real small-SaaS site used for rehearsal) on `/onboarding` produces a prefilled company form with all seven fields and 3–5 clarifying questions, each stating why it matters, within 90 s.
- [x] AC2 (live draft of buffer.com: domain, pricing + partners/agencies pages, RSS feed, 5 questions, emphasis question; saving verified by unit test): Entering `https://buffer.com` as a competitor produces a draft with `domain = buffer.com`, a proposed watchlist that includes the pricing page and the agency page, at least one feed or sitemap, five research questions mentioning the company's priorities, and one emphasis question; saving creates the competitor, watched sources, feeds and questions.
- [x] AC3: Clarifying-question answers appear in the saved company fields and in `company.onboarding`; Settings shows and edits everything created.
- [x] AC4 (action returns the error and an empty editable draft): A URL that cannot be fetched shows an error and an empty editable form instead of failing the page.
- [x] AC5: `npm run check`, `npm test` pass; `drizzle/0009_*.sql` committed.
