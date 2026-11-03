# Pilot runbook

How to run Delta for one design partner for four weeks. The goal is one answer: **did anything Delta surfaced change what they investigated, discussed, recommended or decided?** At least one verified decision within 30 days is the success signal. Dashboard use is not.

## What we ask of the partner

- Their website and their competitors' websites.
- A 30-minute call to answer the clarifying questions onboarding produces.
- One email address for the digest.

Nothing else. They never have to log in, react or reply. Those are optional, and we capture them when they happen.

## What they get

- An email every Monday: hypotheses and how confidence moved, the top insights with one-click **Useful / Wrong / Acted on** links, what changed on which pages, open questions and conflicts between sources.
- A quiet week says so and says what was checked. We don't pad it.
- A dashboard link and password for drilling into the evidence behind any claim.

## How reactions and notes work

- **Reaction links** are signed and need no login. Each records one reaction per insight per digest, and a note can be added on the confirmation page. A "Wrong" triggers a factual review by you.
- **The "Send a note" link** in each digest is the richest input. It opens a short form that needs no login. A URL becomes a page for the next run. Free text becomes an internal note, credited to the name they give, or to "digest reader" if they leave it blank. Replies to the email itself are not read.
- **Corrections are authoritative about the partner's own company only.** What they say about a competitor is stored as "per <sender> (internal)": an unverified claim that moves a hypothesis by at most 0.1 and is never presented as public fact.

## What we store and who processes it

Tell the partner this before you start:

- **Stored on our server:** public pages of their competitors (text and HTML), the company profile they approved, their notes and reactions.
- **Third parties that process it:**
  - the model provider (page text, the company profile and their notes are sent for analysis)
  - Exa (search queries naming competitors)
  - Resend (digest emails)
  - the VPS host
- **To stop:** tell us, and we stop the digest and delete the instance's database and backups.

## The day-30 question

The fourth digest asks it automatically: *"One question after four weeks: did anything Delta surfaced change what you investigated, discussed, recommended, or decided? Tell us which insight it was and what you did differently."* A button opens the note form.

Answers appear under **Partner answers** on `/ops`. If there is no answer, ask in person. Record every confirmed decision with **Record a decision influenced** on `/ops`. Only record what the partner confirmed, in their words.

## Weekly operator checklist (about 15 minutes)

1. Open `/ops`. Check that the worker dot is green and no job failed.
2. **Held digests:** read the reason. A held digest means a cited quote was not verbatim, a fact postdates its run, or two insight titles duplicate each other. Fix the cause, or use **Send anyway** with a reason, which is recorded.
3. **Label the sample:** after each send the worker writes `data/labels/<date>.csv` with 25 items. Label it following `eval/labels/README.md` (about 20 minutes the first time) and add a line to `eval/labels/ledger.md`.
4. **Wrong reactions:** check each against its source this week, and correct the record if Delta was wrong.
5. **Open conflicts and questions:** add a correction or resolution where you know the answer.
6. **Watchlist:** add anything the partner's notes suggest.

## Go / no-go

These come from the ground-truth audit (`docs/research/ground-truth-audit-2026-11-02.md`):

| Measure | Bar | If missed |
|---|---|---|
| Quotes verbatim | 100% | Digest is held automatically |
| Cutoff leakage | Zero | Digest is held automatically |
| Hard-fact precision | ≥ 98% on a rolling 8 weeks (target ≥ 99%) | Pause digests until understood |
| Stale + duplicate rate | ≤ 5% | Tighten dedupe |
| Material pricing, ownership or availability error | None unexamined | Investigate the same week, and tell the partner if it was sent |

## After the four weeks

Answer the seven questions at the end of `docs/plans/mvp/initial-mvp-thoughts.md` using `/ops` and the ledger. They decide the MVP plan.
