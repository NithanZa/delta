# Delta — 4-minute demo script

Before you start: `npm run demo:restore && npm run dev`, open http://localhost:3000, and have `/c/buffer` loaded. If you plan to run live, make sure `.env.local` has the key and the API is reachable; otherwise stay on the restored database.

## 0:00 — The problem (home page, 20 s)

"Every PM watches competitors in browser tabs and Slack threads. Signals are scattered across pricing pages, blog posts, docs and job listings, and nobody keeps the record of what we believed last quarter and why. Delta is an AI analyst that does the reading, keeps the record, and tells *us* what to do."

Point at the Loop profile: a six-person scheduling tool whose priority is winning agencies. "Delta knows who we are, so it can judge what matters."

## 0:20 — The evidence is real (Evidence tab, 30 s)

Open the Evidence tab. "18 real Buffer pages, dated, unedited: Wayback captures of the pricing page in 2023, 2024, 2025, live case studies, the support docs. Each run only sees pages dated before its cutoff; the header says so."

Expand one pricing snapshot. "Every fact comes with a verbatim quote, and the code rejects any quote that is not actually in the page. 3 of 44 facts were dropped on this page alone."

## 0:50 — Run 1: the hypothesis forms (Overview, 40 s)

Click Run 1's chip, then back to Overview. Read H1: "Buffer is investing in small agencies as a segment — 65%." Expand History → "created, with the fact ids."

"This is `step-5-preview` reading 47 facts and separating what it observed from what it infers. Note H4: Delta believed Buffer had *no* partner program. Keep that in mind."

## 1:30 — Run 2: strengthened (Overview + Timeline, 30 s)

"Run 2 adds 2024 pages: the Agency plan was cut from $120 to $100, support docs recommend it for 11+ channels." Show the hypothesis history: strengthened, confidence up. Switch to Timeline: the price cut event links back to the 2023 pricing event.

"Change detection compared two captures of the same URL and only sent the diff to `step-3.7-flash`."

## 2:00 — Run 3: contradicted and revised (Overview, 50 s)

"Run 3 sees 2025–2026. The Agency plan is gone. A naive tracker says 'Buffer abandoned agencies'. Delta doesn't." Show the revised hypothesis: old statement struck through, new one below it, the history on both rows.

"Buffer dropped the dedicated tier but launched an Agency Partner Program with 25% recurring commission and published 'Every Team feature, built for agencies'. H4 — 'no partner program' — is contradicted. The open question Delta raised in Run 1, 'does Buffer have a partner program?', is resolved in Run 3." (Questions tab, 5 s.)

## 2:50 — The insight for Loop (Insights tab, 40 s)

Pick the high-severity insight. Read the four labels: Observed · Inferred · Why it matters to Loop · Recommended. "Notice the action is *investigate*, not *build*: it gives us the customer-interview questions to ask before we spend engineering time. That is what a good analyst does."

Expand "facts with verbatim quotes" to show the chain insight → facts → source page.

## 3:30 — It is a living record (Overview + Evidence, 30 s)

Click "Correct this interpretation" on a hypothesis, type a one-line correction, save: the badge says *corrected by you*. "The next run treats this as authoritative." Then on Evidence, paste a fresh Buffer URL → it lands under *Not yet processed*. "Same pipeline as the seeded pages; the next run picks it up."

If there is time and the network is healthy, click **Run Run 4**: it analyzes the new page and re-reads the correction. Otherwise say: "A run takes about five minutes with the real API; we shipped the completed runs in the repo so the demo never depends on the network."

## Close (10 s)

"Two StepFun models, two jobs: `step-3.7-flash` reads pages fast and cheaply; `step-5-preview` holds the whole research record in its million-token context and revises what it believes. Delta turns competitor noise into a maintained record of evidence, hypotheses, and the decisions they should inform."

## Fallbacks

- API down during a live run: the run fails visibly with the error in the panel; say so and continue on the restored DB (`npm run demo:restore`, refresh).
- Stream drops on a long synthesis: the panel falls back to polling; nothing is lost.

## Screenshots to take

1. Overview after Run 3 with the revised hypothesis expanded (struck-through old statement, history).
2. An insight card with the four sections and an *investigate* action, facts expanded.
