# Delta — initial idea

Submission for **Track 2 · Build with StepFun** at the StepFun × NYU PMC Case Jam (Oct 30 – Nov 1, 2026). Deadline: Sunday Nov 1, 4:00 PM ET.

## The idea

**Delta is an AI competitive intelligence analyst that continuously researches competitors, builds an understanding of their strategies, and develops actionable insights for your company.**

It tracks relevant activity across public sources, including blogs, product launches, release notes, documentation, website messaging, pricing, partnerships, customer stories, interviews, and job listings. It looks for both major announcements and smaller details that reveal what a competitor might be planning.

Users begin by describing their own company: its product, target customers, positioning, priorities, and constraints. They then select competitors and research questions. This context helps Delta determine which developments matter and what responses are realistic.

**Delta connects individual moves into a developing picture of each competitor.** It investigates questions such as:

- Which customer segments are they increasingly targeting?
- What problems are they prioritizing?
- How are they acquiring customers and distributing their product?
- What capabilities or partnerships are they investing in?
- What does their activity suggest about their next moves?
- Where does this create a threat or opportunity for our company?

For example, a competitor might mention agency customers in a blog, release a feature for managing multiple client accounts, and announce a partnership with a marketing consultancy. Delta could connect these developments into a hypothesis that the competitor is investing in agencies as a customer segment and distribution channel.

It would then investigate that hypothesis by examining relevant documentation, customer stories, and onboarding flows. It should also look for evidence that challenges the interpretation.

**Research continues across runs.** Delta retains previous evidence, findings, hypotheses, and unanswered questions. When it discovers something new, it determines whether that information strengthens an existing interpretation, contradicts it, or suggests a different direction. Important uncertainties become follow-up research tasks.

The product would provide several connected outputs:

| Output | What it contains |
|---|---|
| Competitor timeline | Meaningful developments, dates, sources, and relationships to earlier events |
| Strategy profile | Current understanding of the competitor's customers, product direction, positioning, distribution, and business model |
| Insight feed | Findings that matter to your company, with explanations of their significance |
| Recommended actions | Specific responses or investigations, informed by your priorities and capabilities |
| Evidence history | Supporting passages, source links, conflicting information, and how conclusions have changed |

An insight should explain **what happened, what it might mean, why it matters to your company, and what to do next**.

For instance, if your company also targets agencies, Delta might recommend investigating whether client-account management has become a buying requirement. It could identify questions for customer interviews and compare the relevant workflows before recommending a product investment.

Every insight should distinguish observed facts from inferred intentions and proposed actions. Users should be able to inspect the evidence, understand the uncertainty, and correct Delta's interpretation.

**StepFun powers the core analytical work:** extracting meaningful details, choosing follow-up investigations, connecting evidence across sources and time, updating strategic hypotheses, and generating company-specific recommendations.

Over time, Delta becomes a maintained research record of each competitor's behavior and the decisions that behavior should inform.

## Decisions made before building (Oct 31, 2026)

1. **Models.** `step-3.7-flash` for high-volume extraction (per-page fact and signal extraction, classification). `step-5-preview` (1M context) for the cross-source reasoning: hypothesis updates, timeline linking, insights and recommendations. Both reached via the OpenAI-compatible endpoint at `https://api.stepfun.ai/v1`.
2. **Source data.** A seeded snapshot corpus is the spine; live "Add URL" fetch is secondary; no search API yet. Real, dated, unedited pages for one competitor, grouped into Run 1 → Run 2 → Run 3 by date cutoff. Each run only sees pages dated before its cutoff. Snapshots are stored as `{url, source_type, published_at, fetched_at, raw_html, extracted_text, content_hash}`. Live fetches go through the same pipeline and are saved as snapshots, so nothing downstream can tell a live page from a seeded one. Source discovery sits behind a `SourceProvider` interface (`seeded`, `manual_url`, later `search`). The UI says "Replaying snapshots captured on [dates]".
3. **Demo scenario.** Keep it simple and close to the brief's own example: the user's company is a small social-media scheduling tool, and the competitor is a real, well-known player in that space whose public history contains an actual pivot or reversal.
4. **Stack.** Local-first. Next.js (App Router) + TypeScript + Tailwind, SQLite via Drizzle (one file, zero setup, zips cleanly for submission), Zod-validated JSON outputs from StepFun, research runs that stream progress to the UI. No auth. No hosted deploy required.
5. **Judging focus.** The Track 2 rubric weights "Meaningful Use of StepFun Models" at 25% and "Technical Execution" at 20%. The run-over-run hypothesis revision (strengthen → contradict → revise) is the differentiator and is what the demo must show.
