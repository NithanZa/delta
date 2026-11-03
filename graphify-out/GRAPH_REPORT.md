# Graph Report - delta  (2026-11-03)

## Corpus Check
- 67 files · ~539,353 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1932 nodes · 4813 edges · 100 communities (97 shown, 3 thin omitted)
- Extraction: 95% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 215 edges (avg confidence: 0.87)
- Token cost: 189,591 input · 0 output

## Community Hubs (Navigation)
- App Pages, Actions & UI Kit
- Drizzle DB Schema
- Discovery & Absence Topics
- Corpus Seeding & Providers
- AI SDK LLM Client
- Run Orchestration & Presets
- Docker Compose Stack
- DB Setup & Test Fixtures
- Job Queue & Worker
- Hackathon Plan: Ingestion & Demo
- Wayback Backfill
- Hackathon Critical Path & Risks
- Fact Extraction & Diff
- Eval Sampler & Recall
- Onboarding Actions & Forms
- Hackathon Plan: Outputs & UI
- Pipeline State & Guards
- README: Pilot Features
- npm Scripts
- Inbound Email Replies
- Runtime Dependencies
- Crawler & Feeds
- Onboarding Drafts & Relevance
- Eval Case Harness
- Deploy: Backups, Caddy, Env
- Dev Dependencies & Tooling
- Settings Actions & Jobs API
- Eval Quality Gates
- Pilot Runbook & Go/No-Go
- Signed Links & Reactions
- Safe Page Fetching
- Ops Actions & Decisions
- Deploy Runbook & Public Routes
- Buffer Pricing 2025 Bands
- Watchlist Settings Forms
- TypeScript Config
- Screenshot: Insight Card
- Doctor, Smoke & Pricing
- Settings Forms & Queries
- Insight Ranking & Novelty
- Lenient Zod Schemas
- Digest Job & Decision Question
- Watchlist Feed Discovery
- LLM Config & Providers
- Package Script & Seed Test
- Digest Email Sending
- Screenshot: Hypothesis Revision
- Buffer Pricing Oct 2026
- SocialPilot Acquisition
- Settings, Health & Onboarding Page
- Digest Content & Thresholds
- Demo Story & Judging
- Screenshot: What Changed Strip
- Agency Features Compared
- Wire Schemas
- Robots.txt Handling
- Buffer Pricing 2023
- CI Workflow
- Prototype Success Signals
- Buffer Agency Blog 2026
- Approach & StepFun Models
- Prototype Cost & Attribution Rules
- Per-Channel Pricing
- Ops Dashboard & Events
- Reaction Links Route
- Extraction Prompts & Context
- Audit: Calibration & Trust Budget
- Backfill Plan & Point-in-Time
- Deploy Plan: Compose & Health
- Prototype Model Layer Plan
- Billing Cadence & MCP
- Buffer Agency Pages 2023
- Fair Use & AI Credits
- Buffer Developer API
- Digest & Discovery Settings Forms
- Digest Rendering
- Readable Text Extraction
- Mock LLM Client
- Scheduler & Backfill UI Plan
- Trust Fixes from Audit
- Crawler & Onboarding Plan
- Baseline Audit Metrics
- Eval Harness & CI Plan
- Slack Digest
- Export, Golden Timeline & Labeling
- Exa Discovery & Point-in-Time
- Buffer Agency Plan History
- Affiliate & Partner Programs
- Backups & Doctor Plan
- Pilot Readiness Thresholds
- ESLint Config
- Pricing Page Aug 2024
- Backfill CLI & CDX Plan
- Caddy & Public Routes Plan
- Cookie Banner Noise
- Instrumentation Funnel
- Optional Dependencies
- MVP & Prototype Gates

## God Nodes (most connected - your core abstractions)
1. `drizzle-orm` - 59 edges
2. `createDb()` - 49 edges
3. `getDb()` - 42 edges
4. `Badge()` - 35 edges
5. `Button()` - 35 edges
6. `vitest` - 33 edges
7. `cx()` - 32 edges
8. `env` - 31 edges
9. `insertSnapshotRecord()` - 30 edges
10. `next` - 30 edges

## Surprising Connections (you probably didn't know these)
- `SourceProvider interface (seeded, manual_url, later search)` --semantically_similar_to--> `SourceProvider`  [INFERRED] [semantically similar]
  docs/initial-idea.md → README.md
- `SourceProvider interface` --semantically_similar_to--> `SourceProvider`  [INFERRED] [semantically similar]
  docs/plan/phase2-ingestion-corpus.md → README.md
- `Backfill ordering invariant (ascending cutoffs)` --semantically_similar_to--> `Three-run cutoff replay demo`  [INFERRED] [semantically similar]
  src/lib/backfill/README.md → README.md
- `Monday digest email` --semantically_similar_to--> `Weekly digest for a design partner`  [INFERRED] [semantically similar]
  docs/pilot-runbook.md → README.md
- `CLI scripts (eval, crawl, discover, worker, digest, backfill, doctor)` --references--> `runBackfill`  [INFERRED]
  README.md → src/lib/backfill/README.md

## Import Cycles
- 2-file cycle: `src/components/overview.tsx -> src/components/run-delta.tsx -> src/components/overview.tsx`
- 2-file cycle: `src/lib/llm/aiSdk.ts -> src/lib/llm/client.ts -> src/lib/llm/aiSdk.ts`
- 3-file cycle: `src/components/overview.tsx -> src/components/since-strip.tsx -> src/components/run-delta.tsx -> src/components/overview.tsx`

## Hyperedges (group relationships)
- **Audit failure modes fixed by phase 3 trust fixes** — docs_research_ground_truth_audit_2026_11_02_annual_vs_monthly_error, docs_research_ground_truth_audit_2026_11_02_roadmap_as_shipped_error, docs_research_ground_truth_audit_2026_11_02_absence_claim_error, docs_research_ground_truth_audit_2026_11_02_conflicting_pages_error, docs_plans_prototype_phase3_trust_fixes_billing_cadence, docs_plans_prototype_phase3_trust_fixes_availability_status, docs_plans_prototype_phase3_trust_fixes_absence_cap, docs_plans_prototype_phase3_trust_fixes_conflict_questions, docs_plans_prototype_phase2_eval_harness_regression_suite [EXTRACTED 1.00]
- **Buffer developer platform: API, MCP server, CLI, keys, limits and machine-readable pricing** — eval_cases_fixtures_e14_buffer_api_launch_2026_05_27_buffer_api, eval_cases_fixtures_e14_buffer_api_launch_2026_05_27_buffer_mcp_server, eval_cases_fixtures_e14_buffer_api_launch_2026_05_27_buffer_cli, eval_cases_fixtures_e14_buffer_api_launch_2026_05_27_api_keys_channel_scoped, eval_cases_fixtures_e14_buffer_api_launch_2026_05_27_api_plan_limits, eval_cases_fixtures_e14_buffer_api_launch_2026_05_27_machine_readable_pricing, eval_cases_fixtures_e18_pricing_2026_10_31_api_rate_limit_windows, eval_cases_fixtures_e18_pricing_2026_10_31_oauth_app_clients [EXTRACTED 1.00]
- **Buffer pricing page capture series (Jun 2023 → Dec 2023 → Aug 2024)** — eval_cases_fixtures_e09_pricing_2023_06_17_buffer_pricing_page, eval_cases_fixtures_e08_prev_pricing_2023_06_17_buffer_pricing_page, eval_cases_fixtures_e08_cur_pricing_2023_12_01_buffer_pricing_page, eval_cases_fixtures_e02_prev_pricing_2023_12_01_buffer_pricing_page, eval_cases_fixtures_e02_cur_pricing_2024_08_16_buffer_pricing_page, eval_cases_fixtures_e05_pricing_2024_08_16_buffer_pricing_page [EXTRACTED 1.00]
- **Weekly digest and feedback loop** — docs_plans_prototype_phase6_insight_ranking_builddigestcontent, docs_plans_prototype_phase7_digest_and_feedback_weekly_email_digest, docs_plans_prototype_phase7_digest_and_feedback_signed_reaction_links, docs_plans_prototype_phase7_digest_and_feedback_inbound_reply_capture, docs_plans_prototype_phase7_digest_and_feedback_instrumentation_events, docs_plans_prototype_phase12_pilot_readiness_thirty_day_question [EXTRACTED 1.00]
- **Hypothesis card anatomy: tag, status badge, struck prior claim, new claim, confidence bar, correction button, history** — docs_screenshots_02_hypothesis_revised_h7_hypothesis_card, docs_screenshots_02_hypothesis_revised_h7_category_tag, docs_screenshots_02_hypothesis_revised_h7_hypothesis_status_badge, docs_screenshots_02_hypothesis_revised_h7_strikethrough_prior_claim, docs_screenshots_02_hypothesis_revised_h7_confidence_bar, docs_screenshots_02_hypothesis_revised_h7_correct_this_interpretation_button, docs_screenshots_02_hypothesis_revised_h7_history_timeline [EXTRACTED 1.00]
- **Four-section insight structure: Observed, Inferred, Why it matters, Recommended** — docs_screenshots_03_insight_partner_program_observed_section, docs_screenshots_03_insight_partner_program_inferred_section, docs_screenshots_03_insight_partner_program_why_it_matters_section, docs_screenshots_03_insight_partner_program_recommended_section [EXTRACTED 1.00]
- **Phase 3 trust-fix mechanisms** — eval_results_baseline_2026_11_billingcadence_column, eval_results_baseline_2026_11_availability_column, eval_results_baseline_2026_11_absence_claim_cap, eval_results_baseline_2026_11_conflict_question, eval_results_baseline_2026_11_assertpointintime, eval_results_baseline_2026_11_cadence_switch_guard [EXTRACTED 1.00]
- **Research run pipeline: select → extract → synthesize → insights → finalize** — docs_plan_phase3_extraction_selectsnapshotsforrun, docs_plan_phase3_extraction_runextraction, docs_plan_phase4_synthesis_runs_runsynthesis, docs_plan_phase4_synthesis_runs_runinsights, docs_plan_phase4_synthesis_runs_executerun, docs_plan_phase5_ui_core_api_runs_route, docs_plan_phase4_synthesis_runs_run_cli [EXTRACTED 1.00]
- **SocialPilot plan ladder (Essentials / Standard / Premium / Ultimate / Enterprise)** — eval_cases_fixtures_e06_sp_plans_2026_10_31_essentials_plan, eval_cases_fixtures_e06_sp_plans_2026_10_31_standard_plan_15, eval_cases_fixtures_e06_sp_plans_2026_10_31_premium_plan, eval_cases_fixtures_e06_sp_plans_2026_10_31_ultimate_plan, eval_cases_fixtures_e06_sp_plans_2026_10_31_enterprise_plan [EXTRACTED 1.00]
- **SourceProvider implementations (seeded, manual_url, search stub)** — docs_plan_phase2_ingestion_corpus_sourceprovider, docs_plan_phase2_ingestion_corpus_seededprovider, docs_plan_phase2_ingestion_corpus_manualurlprovider, docs_plan_phase2_ingestion_corpus_searchprovider [EXTRACTED 1.00]
- **Buffer agency go-to-market: per-channel pricing, volume discounts, partner program, agency content** — eval_cases_fixtures_e17_agency_blog_2026_06_17_agency_blog_post, eval_cases_fixtures_e18_agency_page_2026_10_31_agency_landing_page, eval_cases_fixtures_e18_agency_page_2026_10_31_agency_partner_program, eval_cases_fixtures_e15_affiliate_program_agency_partner_program, eval_cases_fixtures_e17_agency_blog_2026_06_17_priced_per_channel_not_per_seat, eval_cases_fixtures_e18_agency_page_2026_10_31_volume_discount_above_10_channels, eval_cases_fixtures_e11_cur_pricing_2025_11_20_bands_volume_pricing_bands [INFERRED 0.85]
- **Buffer pricing page snapshots over time (2023 -> 2024 -> 2025 -> 2026)** — eval_cases_fixtures_e10_pricing_2023_06_17_buffer_pricing_page_2023_06, eval_cases_fixtures_e11_prev_pricing_2024_08_16_buffer_pricing_page_2024_08, eval_cases_fixtures_e11_cur_pricing_2025_11_20_bands_buffer_pricing_bands_page, eval_cases_fixtures_e11_cur_pricing_2025_12_15_buffer_pricing_page_2025_12, eval_cases_fixtures_e12_pricing_annual_block_annual_only_pricing_page, eval_cases_fixtures_e10_pricing_2026_10_31_buffer_pricing_page_2026_10, eval_cases_fixtures_e18_pricing_2026_10_31_buffer_pricing_page_2026_10 [INFERRED 0.85]
- **Cutoff-based archive replay run flow** — docs_screenshots_01_overview_what_changed_run3_archive_replay_banner, docs_screenshots_01_overview_what_changed_run3_run_strip, docs_screenshots_01_overview_what_changed_run3_run_run_4_button [INFERRED 0.85]
- **Hypothesis revision provenance: run updates hypothesis, history records confidence delta and rationale, rationale cites facts** — docs_screenshots_02_hypothesis_revised_h7_run_attribution, docs_screenshots_02_hypothesis_revised_h7_history_timeline, docs_screenshots_02_hypothesis_revised_h7_revision_rationale, docs_screenshots_02_hypothesis_revised_h7_fact_citation_links, docs_screenshots_02_hypothesis_revised_h7_confidence_bar [INFERRED 0.85]
- **Evidence traceability: insight headline cites fact IDs backed by verbatim-quote fact cards** — docs_screenshots_03_insight_partner_program_insight_headline, docs_screenshots_03_insight_partner_program_observed_section, docs_screenshots_03_insight_partner_program_fact_list, docs_screenshots_03_insight_partner_program_fact_card [INFERRED 0.85]
- **What-changed strip: insight lifecycle display pattern** — docs_screenshots_01_overview_what_changed_run3_what_changed_strip, docs_screenshots_01_overview_what_changed_run3_insight_status_badges, docs_screenshots_01_overview_what_changed_run3_confidence_delta, docs_screenshots_01_overview_what_changed_run3_revised_insight_strikethrough, docs_screenshots_01_overview_what_changed_run3_retired_insight_pointer [INFERRED 0.85]
- **Hypothesis lifecycle: created → strengthened → contradicted → revised (supersedesId)** — docs_plan_phase1_foundation_hypotheses_table, docs_plan_phase1_foundation_hypothesisupdates_table, docs_models_revision_not_deletion, docs_plan_phase4_synthesis_runs_synthesize_prompt, docs_plan_phase4_synthesis_runs_hypothesis_arc, docs_demo_script_superseded_section, docs_plan_phase6_insights_evidence_corrections_hypothesis_inline_diff [INFERRED 0.95]
- **Delta analysis pipeline (source to insight)** — readme_sourceprovider, readme_snapshot, readme_readability, readme_extract_model, readme_synthesize_model, readme_insights [EXTRACTED 1.00]
- **Point-in-time correctness (no cutoff leakage)** — src_lib_backfill_readme_ordering_invariant, src_lib_backfill_readme_selectsnapshotsforrun, src_lib_backfill_readme_assertpointintime, docs_pilot_runbook_cutoff_leakage, docs_pilot_runbook_held_digests [INFERRED 0.85]
- **Partner feedback loop (digest, reactions, replies, decisions)** — docs_pilot_runbook_monday_digest, docs_pilot_runbook_reaction_links, docs_pilot_runbook_email_replies, docs_pilot_runbook_internal_claim_cap, docs_pilot_runbook_day_30_question, docs_pilot_runbook_record_decision [INFERRED 0.85]
- **Wayback backfill flow: CDX listing, planning, execution with point-in-time guard** — docs_plans_prototype_phase10_backfill_cdx_client, docs_plans_prototype_phase10_backfill_planbackfill, docs_plans_prototype_phase10_backfill_backfill_execution, docs_plans_prototype_phase10_backfill_assertpointintime, src_lib_backfill_readme_selectsnapshotsforrun [EXTRACTED 1.00]
- **VPS deployment stack (web, worker, Caddy, health)** — docs_plans_prototype_phase11_deployment_dockerfile, docs_plans_prototype_phase11_deployment_docker_compose, docs_plans_prototype_phase11_deployment_caddyfile, docs_plans_prototype_phase5_scheduler_worker_worker_process, docs_plans_prototype_phase11_deployment_health_endpoint [EXTRACTED 1.00]
- **Pilot value measurement (30-day question, partner answers, decisions, funnel)** — docs_plans_prototype_phase12_pilot_readiness_thirty_day_question, docs_plans_prototype_phase12_pilot_readiness_partner_answers, docs_plans_prototype_phase12_pilot_readiness_decision_influenced_event, docs_plans_prototype_phase12_pilot_readiness_funnel [EXTRACTED 1.00]

## Communities (100 total, 3 thin omitted)

### Community 0 - "App Pages, Actions & UI Kit"
Cohesion: 0.05
Nodes (103): nextConfig, next, AboutBotPage(), metadata, ActionResult, correctHypothesis(), correctInsight(), Correction (+95 more)

### Community 1 - "Drizzle DB Schema"
Cohesion: 0.04
Nodes (54): Availability, BillingCadence, ClaimKind, competitors, DIGEST_CHANNELS, DIGEST_STATUSES, DigestItem, digestItems (+46 more)

### Community 2 - "Discovery & Absence Topics"
Cohesion: 0.06
Nodes (35): arg(), flag(), iso(), main(), add(), main(), FactCategory, discoverCompetitor() (+27 more)

### Community 3 - "Corpus Seeding & Providers"
Cohesion: 0.08
Nodes (37): db, args, force, main(), snapshotFileName(), main(), readJson(), SeedCompetitor (+29 more)

### Community 4 - "AI SDK LLM Client"
Cohesion: 0.08
Nodes (29): ai, zod, AiSdkClient, AiSdkClientOptions, SdkUsage, anthropicConfig, clientWith(), Generate (+21 more)

### Community 5 - "Run Orchestration & Presets"
Cohesion: 0.11
Nodes (33): arg(), main(), Body, POST(), RunKind, RunLogEntry, page(), setupTwoRuns() (+25 more)

### Community 6 - "Docker Compose Stack"
Cohesion: 0.05
Nodes (40): depends_on, env_file, image, ports, restart, volumes, web, HOSTNAME (+32 more)

### Community 7 - "DB Setup & Test Fixtures"
Cohesion: 0.11
Nodes (23): seed(), better-sqlite3, drizzle-orm, vitest, db, db, tables, createDb() (+15 more)

### Community 8 - "Job Queue & Worker"
Cohesion: 0.12
Nodes (29): db, worker, Job, runBackfill(), exaTextFallback(), appendLog(), claimNext(), enqueue() (+21 more)

### Community 9 - "Hackathon Plan: Ingestion & Demo"
Cohesion: 0.07
Nodes (31): 4-minute demo script, Living record: correct a hypothesis, add a live URL, Open question: $10 vs $12 per-channel pricing inconsistency, Snapshot shape {url, source_type, published_at, fetched_at, raw_html, extracted_text, content_hash}, SourceProvider interface (seeded, manual_url, later search), quoteIsVerbatim() verbatim-quote enforcement, snapshots table, createSnapshot (fetch, extract, hash, upsert source, dedupe) (+23 more)

### Community 10 - "Wayback Backfill"
Cohesion: 0.11
Nodes (29): arg(), flag(), main(), Db, CDX, fixture(), page(), BackfillPlan (+21 more)

### Community 11 - "Hackathon Critical Path & Risks"
Cohesion: 0.08
Nodes (25): Demo fallbacks (restore DB, polling on stream drop), AiSdkClient adapter, callJson({task, role, system, user, schema, wire}), MockLlmClient offline mode (DELTA_MOCK_LLM=1), Retry policy: schema error retry, length doubling, LlmError on refusal, Vercel AI SDK (ai 7.x) with anthropic and openai-compatible providers, Strict wire schemas (wire.ts) for structured outputs, callJson StepFun client (JSON mode, Zod, retry once) (+17 more)

### Community 12 - "Fact Extraction & Diff"
Cohesion: 0.13
Nodes (28): emptyUsage(), CompanyContext, diffUnits(), focusUnits(), splitUnits(), UnitDiff, detectChangesForSnapshot(), extractFactsForSnapshot() (+20 more)

### Community 13 - "Eval Sampler & Recall"
Cohesion: 0.11
Nodes (21): arg(), list(), loadCases(), openReadOnly(), Row, SampleResult, seeded(), writeLabelSample() (+13 more)

### Community 14 - "Onboarding Actions & Forms"
Cohesion: 0.12
Nodes (28): CompanyDraftState, CompetitorDraftState, createCompetitorAction(), draftCompanyAction(), draftCompetitorAction(), emptyCompanyDraft(), enqueueFromOnboarding(), readable() (+20 more)

### Community 15 - "Hackathon Plan: Outputs & UI"
Cohesion: 0.10
Nodes (32): Superseded section (H4 → H7, H6 → H8 revisions), Competitor timeline output, Evidence history output, Strategy profile output, Per-role usage and cost tracking (runs.stats.byRole, pricing.ts), facts table (statement, quote, category, importance, isChange), hypotheses table (dimension, confidence, status, supersedesId, userCorrection), hypothesisUpdates table (change, prev/new confidence, reasoning, factIds) (+24 more)

### Community 16 - "Pipeline State & Guards"
Cohesion: 0.13
Nodes (24): Fact, Hypothesis, HypothesisClaimKind, HypothesisUpdate, OpenQuestion, Run, StrategyProfile, TimelineEvent (+16 more)

### Community 17 - "README: Pilot Features"
Cohesion: 0.09
Nodes (24): Onboarding flow (/onboarding), Dress rehearsal, Backfill history step, Digest thresholds (src/lib/digest/thresholds.ts), npm run eval:recall, Buffer corpus manifest (data/corpus/buffer/manifest.json), SeededProvider (reads manifest), npm run eval:regress (+16 more)

### Community 18 - "npm Scripts"
Cohesion: 0.07
Nodes (29): scripts, backfill, build, check, corpus:fetch, crawl, db:generate, db:push (+21 more)

### Community 19 - "Inbound Email Replies"
Cohesion: 0.14
Nodes (21): resend, POST(), InboundMessage, digestIdFrom(), emailAddress(), extractUrls(), QUOTE_HEADERS, stripQuoted() (+13 more)

### Community 20 - "Runtime Dependencies"
Cohesion: 0.07
Nodes (28): dependencies, ai@^7.0.162, @ai-sdk/anthropic@^4.0.96, @ai-sdk/openai-compatible@^3.0.84, better-sqlite3@^13.0.3, croner@^11.0.0, drizzle-orm@^0.45.4, fast-xml-parser@^5.11.2 (+20 more)

### Community 21 - "Crawler & Feeds"
Cohesion: 0.13
Nodes (24): arg(), flag(), main(), Feed, FeedKind, Source, crawlCompetitor(), CrawlOptions (+16 more)

### Community 22 - "Onboarding Drafts & Relevance"
Cohesion: 0.10
Nodes (24): company, LlmUsage, CompanyDraft, CompanyDraftOutput, companyDraftSystemPrompt(), CompanyDraftWire, conf, draftCompany() (+16 more)

### Community 23 - "Eval Case Harness"
Cohesion: 0.14
Nodes (25): CASES_DIR, describe(), EvalCase, evaluate(), excerpt(), Expectation, FactSpec, FIXTURES_DIR (+17 more)

### Community 24 - "Deploy: Backups, Caddy, Env"
Cohesion: 0.09
Nodes (21): Daily backups and restore, Caddy (TLS + basic auth), DELTA_LINK_SECRET signed links, Docker Compose stack (web, worker, Caddy), .env configuration (DELTA_HOST, DELTA_BASE_URL, keys), URL guard (private/local addresses), Web container, Worker container (scheduler, heartbeat) (+13 more)

### Community 25 - "Dev Dependencies & Tooling"
Cohesion: 0.11
Nodes (23): devDependencies, drizzle-kit@^0.31.11, tailwindcss@^4, @tailwindcss/turbopack@^4, @types/better-sqlite3@^9.6.0, @types/jsdom@^30.0.0, @types/node@^22.20.5, @types/react@^19 (+15 more)

### Community 26 - "Settings Actions & Jobs API"
Cohesion: 0.12
Nodes (23): GET(), GET(), addCompetitor(), CompanyInput, CompetitorDetailsInput, CompetitorInput, DigestSettingsInput, FeedInput (+15 more)

### Community 27 - "Eval Quality Gates"
Cohesion: 0.16
Nodes (21): db, report, exitCodeFor(), FactRow, formatReport(), gateCitations(), gateConfidence(), GateId (+13 more)

### Community 28 - "Pilot Runbook & Go/No-Go"
Cohesion: 0.10
Nodes (21): /ops operator page, npm run eval:gates, Duplicate run skipped with reason, Safety net: held digest on tampered quote, Cutoff leakage (zero bar), Go / no-go bars, Ground-truth audit (2026-11-02), Hard-fact precision >= 98% (+13 more)

### Community 29 - "Signed Links & Reactions"
Cohesion: 0.14
Nodes (19): Reaction, REACTION_KINDS, ReactionKind, b64url(), defaultSecret(), DEV_LINK_SECRET, LINK_TTL_DAYS, LinkPayload (+11 more)

### Community 30 - "Safe Page Fetching"
Cohesion: 0.17
Nodes (16): archiveUrlFor(), FetchedPage, FetchError, fetchPage(), FetchPageOptions, assertPublicHttpUrl(), isPrivateIpv4(), isPublicHttpUrl() (+8 more)

### Community 31 - "Ops Actions & Decisions"
Cohesion: 0.18
Nodes (16): react, Error(), DecisionInput, EnqueueInput, enqueueJob(), OpsState, recordDecision(), requestActor() (+8 more)

### Community 32 - "Deploy Runbook & Public Routes"
Cohesion: 0.12
Nodes (17): Deploying Delta, npm run doctor, Exa discovery, Public routes (/r/*, webhooks, /api/health, /about-bot), Resend (email sending and receiving), Resend replies webhook (/api/webhooks/resend), Close the loop (reply URL and internal note), Discovery and absence checks (+9 more)

### Community 33 - "Buffer Pricing 2025 Bands"
Cohesion: 0.14
Nodes (17): 30-day refund policy, Agencies use the Team plan with volume pricing (no separate Agency plan), Buffer Pricing Page with Volume Bands (Nov 2025, synthetic current), 14-day free trial for Essentials and Team, auto-downgrade to Free, Annual billing 20% discount, switchable with proration, Buffer Pricing Page (Dec 2025 snapshot), Essentials plan $5/mo per channel ($60/yr), 50% nonprofit and charity discount (+9 more)

### Community 34 - "Watchlist Settings Forms"
Cohesion: 0.18
Nodes (19): addFeed(), addProposed(), addWatchSource(), ProposalState, proposeWatchlistAction(), revalidateAll(), setFeedEnabled(), updateSource() (+11 more)

### Community 35 - "TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 36 - "Screenshot: Insight Card"
Cohesion: 0.15
Nodes (19): Action: investigate (interview top 10 referral partners), Action: respond (differentiated partner value proposition), Buffer Agency Partner Program, Compiling status indicator (bottom-left), Fact card (category tag, date, importance, verbatim quote, source URL, fact ID), F254: Buffer partner program with revenue share (Jun 17, 2026), F261: Buffer Agency Partner Program 25% recurring commission (Oct 31, 2026), Fact list (5 facts with verbatim quotes) (+11 more)

### Community 37 - "Doctor, Smoke & Pricing"
Cohesion: 0.18
Nodes (15): offline, rows, Status, main(), Smoke, smoke(), SmokeWire, callJson() (+7 more)

### Community 38 - "Settings Forms & Queries"
Cohesion: 0.21
Nodes (17): AddCompetitorState, saveCompany(), AddCompetitorForm(), CompanyForm(), CompetitorDetailsForm(), DEFAULT_QUESTIONS, fields, initial (+9 more)

### Community 39 - "Insight Ranking & Novelty"
Cohesion: 0.22
Nodes (17): ScoreBreakdown, insightsUserPrompt(), clamp(), evidenceOf(), findSupersededInsight(), fingerprint(), jaccard(), mean() (+9 more)

### Community 40 - "Lenient Zod Schemas"
Cohesion: 0.12
Nodes (16): CLAIM_KINDS, ChangeOutput, ExtractFactsOutput, FactOutput, FactSchema, HypothesisUpdateOutput, idList, idOrNull (+8 more)

### Community 41 - "Digest Job & Decision Question"
Cohesion: 0.18
Nodes (16): Digest, DigestPeriod, citedFactIds(), DECISION_QUESTION, DigestJobOptions, DigestJobResult, firstRunDate(), lastSentDigest() (+8 more)

### Community 42 - "Watchlist Feed Discovery"
Cohesion: 0.18
Nodes (16): CANDIDATE_PATHS, discoverFeedLinks(), FEED_PATHS, fetchText(), looksLikeFeed(), looksLikeSitemap(), Opts, probe() (+8 more)

### Community 43 - "LLM Config & Providers"
Cohesion: 0.15
Nodes (13): LlmEffort, DEFAULT_EFFORT, DEFAULT_MODELS, LlmEnv, LlmProvider, loadLlmConfig(), ModelLabels, ModelSpec (+5 more)

### Community 44 - "Package Script & Seed Test"
Cohesion: 0.12
Nodes (11): exclude, files, listFile, out, root, walk(), dbPath, script (+3 more)

### Community 45 - "Digest Email Sending"
Cohesion: 0.17
Nodes (9): arg(), flag(), main(), EmailSender, FakeSender, ResendLike, ResendSender, SendArgs (+1 more)

### Community 46 - "Screenshot: Hypothesis Revision"
Cohesion: 0.19
Nodes (15): Screenshot: Hypothesis H7 revised (insights feed), Buffer Agency Partner Program (25% recurring commission, priority support, playbooks, co-marketing), Hypothesis category tag (Distribution, Next moves), Confidence bar with percentage (e.g. 70%, 56% -> 70%), 'Correct this interpretation' button (human feedback on hypothesis), Inline fact citation links (F254, F261, F265, F287, F305, F255, F269) with 'N facts cited - show quotes', History section ('N updates - how this conclusion changed') with per-run revision entries, Hypothesis card (dark-theme stacked feed of competitor hypotheses) (+7 more)

### Community 47 - "Buffer Pricing Oct 2026"
Cohesion: 0.17
Nodes (14): Alexandrea Bowman (Sapphire Social) testimonial, API access tiers on every plan (1/3/5 keys; 1k/3k/10k requests per channel), Buffer Pricing Page (Oct 2026 snapshot, E10 variant), Machine-readable pricing (for AI agents) link, Takeaways: AI-powered performance observations, API plan limits: Free 1 key/1k per channel up to 3k; Essentials 3/3k up to 30k; Team 5/10k up to 100k, Machine-readable pricing page for agents, Native integrations: Canva, Zapier, Make, n8n, Google Photos, Unsplash (+6 more)

### Community 48 - "SocialPilot Acquisition"
Cohesion: 0.17
Nodes (11): Cinven (majority owner of group.one), Fredrik Nilsson (group.one CEO), group.one (European hosting group; one.com, Zone, Hostnet; Cinven-owned), Jimit Bagadiya (SocialPilot founder and CEO), Press release: group.one acquires SocialPilot (July 10, 2025), SocialPilot (social media management platform, 13,500+ agencies and SMBs), Buffer for Agencies landing page (Oct 2026), Buffer Agency Partner Program (25% recurring commission, apply/approve/earn) (+3 more)

### Community 49 - "Settings, Health & Onboarding Page"
Cohesion: 0.20
Nodes (10): dynamic, STEPS, initial, getSchedule(), getSetting(), nextCronRun(), Schedule, SETTING_DEFAULTS (+2 more)

### Community 50 - "Digest Content & Thresholds"
Cohesion: 0.20
Nodes (13): Company, buildDigestContent(), ChangeItem, competitorDigest(), HypothesisMove, isQuiet(), periodSincePreviousRun(), CHANGE_IMPORTANCE_MIN (+5 more)

### Community 51 - "Demo Story & Judging"
Cohesion: 0.19
Nodes (8): Delta initial idea (Track 2, Build with StepFun), Insight feed output, Recommended actions output, insights table (four sections, severity, actions, userCorrection), insights prompt (2-5 company-specific insights, respond/investigate actions), runInsights (write insights), InsightsFeed (Observed / Inferred / Why it matters / Recommended), StepFun integration doc (docs/stepfun-integration.md, now docs/models.md)

### Community 52 - "Screenshot: What Changed Strip"
Cohesion: 0.20
Nodes (14): Screenshot: Overview tab with 'What changed in Run 3' strip (Buffer competitor), Insight H9: Buffer Agency Partner Program (25% recurring commission), Archive replay banner, Competitor profile header (Buffer), Confidence delta (before -> after %), Delta competitive intelligence analyst, Insight status badges (created / strengthened / revised / retired), Customer context: 'for Loop' (+6 more)

### Community 53 - "Agency Features Compared"
Cohesion: 0.16
Nodes (14): Buffer Team plan ($12 monthly / $10 yearly per channel), Buffer agency blog post 2026-06-17 (reporting, security, integrations, roadmap), Open Buffer API, Enforceable two-factor authentication on Team plan, Guest access (coming soon, roadmap), Report export to CSV, PDF or markdown; Takeaways recommendations, Buffer Community (unified comments and DMs inbox), Buffer Community launch post 2025-11-12 (+6 more)

### Community 54 - "Wire Schemas"
Cohesion: 0.14
Nodes (13): DIMENSIONS, HYPOTHESIS_CLAIM_KINDS, SEVERITIES, ChangeWire, ExtractFactsWire, FactWire, HypothesisUpdateWire, InsightActionWire (+5 more)

### Community 55 - "Robots.txt Handling"
Cohesion: 0.23
Nodes (8): groupFor(), isAllowed(), parseRobots(), patternMatches(), ROBOTS_AGENT, RobotsCache, RobotsGroup, RobotsRules

### Community 56 - "Buffer Pricing 2023"
Cohesion: 0.24
Nodes (13): Buffer Essentials plan ($6 monthly / $5 yearly per channel), Buffer Agency plan $120/mo for 10 channels, +$6/mo per extra channel, Buffer pricing page 2023-12-01 (monthly display), Buffer pricing page 2023-12-01 (E08 current), Buffer pricing page 2023-06-17 (E08 previous), Free plan 'Up to 30' scheduled posts (later 10 per channel), Shop Grid and Multi-Channel Campaigns (present June 2023, gone Dec 2023), Buffer pricing page 2023-06-17 (E09 extraction fixture) (+5 more)

### Community 57 - "CI Workflow"
Cohesion: 0.15
Nodes (12): runs-on, steps, jobs, check, name, on, pull_request, push (+4 more)

### Community 58 - "Prototype Success Signals"
Cohesion: 0.17
Nodes (6): Delta MVP (ranked thoughts), buildDigestContent digest content model (src/lib/digest/content.ts), Instrumentation events (digest_sent, insight_viewed, insight_reacted, insight_corrected, source_added, reply_received, decision_influenced), Signed reaction links (HMAC token, Useful/Wrong/Acted on), Optional Slack incoming-webhook mirror, Weekly email digest via Resend

### Community 59 - "Buffer Agency Blog 2026"
Cohesion: 0.21
Nodes (8): Buffer blog: every team feature agencies use (June 17, 2026), Community inbox (comments from every channel in one view), Guest access (coming soon): clients approve content without an account, Ideas library with kanban board, Marin Nedelev: 77 channels across nine countries via API + Google Sheets + n8n, Open Buffer API for custom workflows, Scoped permissions and approval workflows, Buffer SOC 2 compliance

### Community 60 - "Approach & StepFun Models"
Cohesion: 0.24
Nodes (7): Delta — approach & critical path (Oct 31 night), Locked demo story (Loop vs Buffer, three runs), StepFun usage: step-3.7-flash extract, step-5-preview synthesize, Measured StepFun usage (hackathon replay tokens and wall time), Models doc (model-agnostic LLM layer), formatForPrompt(ctx) with stable ids F/H/Q/E, synthesize prompt rules (cite fact ids, revised → supersede, corrections authoritative)

### Community 61 - "Prototype Cost & Attribution Rules"
Cohesion: 0.18
Nodes (7): Cost controls and routing (Batches API, cheaper fallback, cost per run), LLM config (LLM_EXTRACT / LLM_SYNTH provider:model, StepFun fallback), Pricing table and RunStats cost accounting (byRole, cacheReadTokens, costUsd), Anthropic prompt caching of per-competitor system prompt, Regression suite E01-E18 (eval/regress.ts), Phase 3: trust fixes, Inbound reply capture (Resend webhook, URL extraction, internal note snapshot)

### Community 62 - "Per-Channel Pricing"
Cohesion: 0.18
Nodes (10): Buffer pricing page fixture (monthly vs yearly), Per-channel pricing (agencies use Team plan + channel per client), SocialPilot AI credits (one credit per generation, no rollover), SocialPilot help center article: what's in each plan (Oct 2026), SocialPilot Standard plan: 20 accounts, 3 users, 1,000 AI credits, SocialPilot Ultimate: unlimited accounts/users, flat $200/mo, SocialPilot AI Pilot, SocialPilot Standard: $42.50 annual / $50 monthly, 15 accounts, 3 users (+2 more)

### Community 63 - "Ops Dashboard & Events"
Cohesion: 0.31
Nodes (10): DecisionForm(), duration(), dynamic, OpsPage(), statusTone, workerStatus(), heldDigests(), countEvents() (+2 more)

### Community 64 - "Reaction Links Route"
Cohesion: 0.42
Nodes (10): confirmation(), esc(), GET(), hits, ipOf(), LABELS, limited(), page() (+2 more)

### Community 65 - "Extraction Prompts & Context"
Cohesion: 0.24
Nodes (10): AVAILABILITIES, BILLING_CADENCES, FACT_CATEGORIES, formatCompanyContext(), extractFactsSystemPrompt(), ExtractVariant, internalNoteSystemPrompt(), PAGE_TEXT_MARKER (+2 more)

### Community 66 - "Audit: Calibration & Trust Budget"
Cohesion: 0.20
Nodes (6): ALCE and AttributionBench (citation quality evaluation), Ding et al., Citations and Trust in LLM Generated Responses (AAAI 2025), FActScore (atomic fact precision), Flares CI Research, State of CI Tools G2 Review Study (2026), Li & Aral, Human Trust in AI Search (2025), Liu, Zhang & Liang, Evaluating Verifiability in Generative Search Engines (EMNLP 2023)

### Community 67 - "Backfill Plan & Point-in-Time"
Cohesion: 0.24
Nodes (10): assertPointInTime guard, Backfill job execution (src/lib/backfill/run.ts), Backfill cost and time estimate, createSnapshot (provider backfill), fetchPage archive id_ URL form (src/lib/ingest/fetchPage.ts), Dress rehearsal (docs/pilot-rehearsal.md), npm run eval:gates / eval:recall, Held digest and Send anyway override (+2 more)

### Community 68 - "Deploy Plan: Compose & Health"
Cohesion: 0.24
Nodes (9): docker-compose.yml (web, worker, caddy), Dockerfile (multi-stage node:22-bookworm-slim), Health endpoint (src/app/api/health/route.ts), croner 11.0.0, Settings Schedule card, Settings helper (src/lib/settings.ts getSetting/setSetting), settings table, worker.heartbeatAt (+1 more)

### Community 69 - "Prototype Model Layer Plan"
Cohesion: 0.20
Nodes (9): AiSdkClient adapter (src/lib/llm/aiSdk.ts), Phase 1: provider-agnostic LLM layer, Vercel AI SDK (ai 7.x, @ai-sdk/anthropic, @ai-sdk/openai-compatible), Phase 4: watchlist crawler, Phase 6: insight ranking, Phase 7: digest and feedback, Phase 9: onboarding, Phase conventions (Next.js 16 docs first, drizzle-kit migrations, offline tests, verified API notes) (+1 more)

### Community 70 - "Billing Cadence & MCP"
Cohesion: 0.20
Nodes (10): Billing cadence: monthly vs yearly (save 2 months), Buffer MCP server (Claude, ChatGPT agents), Stale Agency+ plan FAQ (Slack vs white label), Annual billing saves 15%, SocialPilot Enterprise (custom, API access, SSO), SocialPilot Essentials: $25.50 annual / $30 monthly, 7 accounts, 1 user, SocialPilot MCP Server Integration, SocialPilot Premium: $85 annual / $100 monthly, 25 accounts, 6 users (+2 more)

### Community 71 - "Buffer Agency Pages 2023"
Cohesion: 0.22
Nodes (10): Buffer partner program (revenue share), Buffer agency page 2024-06-02, Buffer agency page 2023-11-15 (Start Page card removed, still in footer), Start Page no longer listed as an agency tool, Buffer agency page 2023-06-03 (with Start Page card), Start Page card: link-in-bio pages for clients, Buffer Start Page (free, included on every plan; custom domains on Team), Start Page product page 2023-11-15 (+2 more)

### Community 72 - "Fair Use & AI Credits"
Cohesion: 0.20
Nodes (8): 2,000 scheduled post cap per channel (2023 fair use), Buffer Pricing Page (June 2023 snapshot), Essentials plan $6/mo per channel (2023), Free plan: 3 channels, 30 scheduled posts (2023), Team plan $12/mo per channel (2023), Fair Use Policy: 2,000 scheduled post cap per paid channel (2024), Free plan: 10 scheduled posts per channel (2024), AI Pilot (SocialPilot's renamed AI Assistant)

### Community 73 - "Buffer Developer API"
Cohesion: 0.29
Nodes (9): Channel-scoped API keys created in account settings, Buffer REST API (posts, channels, ideas, tags, analytics), Buffer CLI (buffer post create / channel list / analytics export), Buffer MCP server (open source, local or hosted connector), developers.buffer.com documentation, Buffer API, MCP server and CLI launch post (May 27, 2026), Model Context Protocol (Claude, ChatGPT, Cursor clients), Buffer MCP server connects to Claude and ChatGPT (+1 more)

### Community 74 - "Digest & Discovery Settings Forms"
Cohesion: 0.22
Nodes (6): saveDigestSettings(), SettingsState, DigestSettingsForm(), DigestSettingsValues, initial, initial

### Community 75 - "Digest Rendering"
Cohesion: 0.49
Nodes (9): effectiveScore(), arrow(), competitorHtml(), competitorText(), esc(), fmtDate(), pct(), renderDigest() (+1 more)

### Community 76 - "Readable Text Extraction"
Cohesion: 0.44
Nodes (8): countPrices(), Extracted, extractReadable(), findDatePublished(), findPublishedAt(), normalizeWhitespace(), readabilityLostContent(), toIsoDate()

### Community 77 - "Mock LLM Client"
Cohesion: 0.27
Nodes (4): LlmTask, defaultHandlers, MockHandler, MockLlmClient

### Community 78 - "Scheduler & Backfill UI Plan"
Cohesion: 0.25
Nodes (8): Backfill progress panel UI, Job dispatcher (src/lib/jobs/run.ts), Job queue (src/lib/jobs/queue.ts enqueue/claimNext/finish/appendLog), GET /api/jobs/[id], jobs table, nextRun (replaces nextReplayRun in presets.ts), runs.kind enum (replay|manual|scheduled|backfill), Run panel (src/components/run-panel.tsx)

### Community 79 - "Trust Fixes from Audit"
Cohesion: 0.25
Nodes (4): Failure mode: annual-billing display read as a price cut, Ground-truth audit and trust-budget research (2026-11-02), Failure mode: conflicting official pages silently resolved (SocialPilot 20/40 vs 25/50), Failure mode: roadmap item treated as shipped (Buffer guest access)

### Community 80 - "Crawler & Onboarding Plan"
Cohesion: 0.25
Nodes (8): crawlCompetitor (src/lib/ingest/crawl.ts), RSS/Atom/sitemap pollers with conditional GET (fast-xml-parser), proposeWatchlist (path probing + feed autodiscovery), robots.txt compliance and polite rate (DeltaResearchBot), draftCompany (company profile + clarifying questions), draftCompetitor (profile, suggested watchlist, research questions, emphasis question), readSite site reader (src/lib/onboarding/fetchSite.ts), SSRF guard (refuse private IPs and localhost)

### Community 81 - "Baseline Audit Metrics"
Cohesion: 0.25
Nodes (7): False no-change rate on pages (≤ 5%), Stale + duplicate rate (≤ 5%), assertPointInTime cutoff guard, billingCadence column, cadenceSwitchNote + PRICE_MOVE suppression in detectChangesForSnapshot, Three-run Buffer replay (npm run demo:fresh), Phase 3 trust fixes (18/19, 2026-11-03)

### Community 82 - "Eval Harness & CI Plan"
Cohesion: 0.29
Nodes (5): CI workflow (check, test, gates on demo DB; no model calls), Deterministic gates G1-G5 (eval/gates.ts), Phase 2: eval harness, Failure mode: absence asserted without a check (SocialPilot affiliate program), Rao, Wong & Callison-Burch, Detecting and Correcting Reference Hallucinations (2026)

### Community 83 - "Slack Digest"
Cohesion: 0.39
Nodes (7): CompetitorDigest, Block, competitorBlock(), mrkdwn(), pct(), postToSlack(), slackMessage()

### Community 84 - "Export, Golden Timeline & Labeling"
Cohesion: 0.33
Nodes (5): Export and MCP server for partner agents, Golden timeline for recall (eval/golden, eval/recall.ts), Labeling sampler (eval/sample.ts, five support labels), Phase 8: discovery, Recall misses (group.one acquisition, Buffer Community, SocialPilot MCP, Buffer API/MCP/CLI, 2024 networks)

### Community 85 - "Exa Discovery & Point-in-Time"
Cohesion: 0.29
Nodes (5): assertPointInTime guard (src/lib/pipeline/guards.ts), Exa search/contents client (src/lib/ingest/exa.ts), Exa contents fallback for JS-only / blocked pages, SearchProvider.discover (off-domain and on-domain query templates with date filters), FinanceGym (point-in-time research benchmark)

### Community 86 - "Buffer Agency Plan History"
Cohesion: 0.33
Nodes (6): Agency plan $120/mo for 10 channels (2023), Agency plan $100/mo for 10 channels ($1,200/yr), extra channels $60/yr, Agency plan $100/mo for 10 channels with 2-hour priority support, Annual-only Plans and Pricing block (synthetic), Agency white-label PDF reports, Branded reports (logo + cover page) Team-only

### Community 87 - "Affiliate & Partner Programs"
Cohesion: 0.33
Nodes (7): $50 minimum payout, monthly via PayPal or bank transfer, 90-day affiliate cookie window, Buffer Affiliate Program page, Agency Partner Program: 25% recurring commission, private community, priority support, Buffer Affiliate Program: 20% recurring commission for 12 months, Affiliate program rules (no self-referrals, no brand-term paid search, no unofficial coupons), Buffer partner program (revenue share for recommendations)

### Community 88 - "Backups & Doctor Plan"
Cohesion: 0.40
Nodes (5): Off-box backups and restore procedure, docs/deploy.md, npm run doctor (scripts/doctor.ts), .env.example, Backup job (better-sqlite3 online backup, keep 14)

### Community 89 - "Pilot Readiness Thresholds"
Cohesion: 0.33
Nodes (5): Partner answers (/ops), Partner runbook (docs/pilot-runbook.md), prototype-v1 tag, 30-day question (every fourth digest), Weekly labeling (eval:sample, eval/labels/ledger.md)

### Community 90 - "ESLint Config"
Cohesion: 0.33
Nodes (5): eslintConfig, eslint@^9, eslint-config-next@16.4.3, eslint, eslint-config-next

### Community 91 - "Pricing Page Aug 2024"
Cohesion: 0.40
Nodes (6): Buffer Agency plan $100/mo for 10 channels (billed $1,200 yearly), Buffer pricing page 2024-08-16 (yearly display), Threads and Bluesky channels added, Agency pricing starts at $100/month, 14-day trial (no cadence stated), Buffer pricing page 2024-08-16 (E05 copy, truncated), Conflict question citing both facts

### Community 92 - "Backfill CLI & CDX Plan"
Cohesion: 0.40
Nodes (5): Backfill CLI (scripts/backfill.ts), Wayback CDX client (src/lib/ingest/wayback.ts listCaptures), pickCaptureBefore, planBackfill (src/lib/backfill/plan.ts), Wayback CDX server API

### Community 93 - "Caddy & Public Routes Plan"
Cohesion: 0.40
Nodes (4): Caddy basic_auth with public route exemptions, Caddyfile reverse proxy, Next.js 16 self-hosting (next start behind proxy), Public routes (/r/*, /api/webhooks/*, /api/health)

### Community 94 - "Cookie Banner Noise"
Cohesion: 0.40
Nodes (4): Cookie banner + navigation boilerplate page (no product content), Cookie categories: necessary, functional, analytics, performance, advertisement, Cookie consent banner (Accept All / Reject All / Customize), Buffer site navigation and footer (Product, Resources, Support, Company, Legal)

### Community 95 - "Instrumentation Funnel"
Cohesion: 0.50
Nodes (4): VPS rehearsal, decision_influenced event, Instrumentation funnel (sent, reacted, replied, decided), /ops page (src/app/ops/page.tsx)

### Community 96 - "Optional Dependencies"
Cohesion: 0.67
Nodes (3): optionalDependencies, @rolldown/binding-win32-x64-msvc@1.2.16, @rolldown/binding-win32-x64-msvc

## Ambiguous Edges - Review These
- `Custom PDF/image reports available on all paid plans` → `Branded reports (logo + cover page) Team-only`  [AMBIGUOUS]
  eval/cases/fixtures/E18-agency-page-2026-10-31.txt · relation: conceptually_related_to
- `Buffer for Agencies landing page (Oct 2026)` → `Buffer site navigation and footer (Product, Resources, Support, Company, Legal)`  [AMBIGUOUS]
  eval/cases/fixtures/E16-cookie-banner.txt · relation: conceptually_related_to
- `Stale Agency+ plan FAQ (Slack vs white label)` → `Stale + duplicate rate (≤ 5%)`  [AMBIGUOUS]
  eval/cases/fixtures/E06-sp-plans-2026-10-31.txt · relation: conceptually_related_to
- `Compiling status indicator (bottom-left)` → `Run badge (Run 3)`  [AMBIGUOUS]
  docs/screenshots/03-insight-partner-program.png · relation: conceptually_related_to

## Knowledge Gaps
- **101 isolated node(s):** `Free plan 'Up to 30' scheduled posts (later 10 per channel)`, `Essentials plan $6/mo per channel (2023)`, `Team plan $12/mo per channel (2023)`, `Threads and Bluesky channels added`, `Cinven (majority owner of group.one)` (+96 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 589 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Buffer corpus manifest (data/corpus/buffer/manifest.json)` connect `README: Pilot Features` to `Corpus Seeding & Providers`, `Demo Story & Judging`?**
  _High betweenness centrality (0.221) - this node is a cross-community bridge._
- **What connects `Free plan 'Up to 30' scheduled posts (later 10 per channel)`, `Essentials plan $6/mo per channel (2023)`, `Team plan $12/mo per channel (2023)` to the rest of the system?**
  _101 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `App Pages, Actions & UI Kit` be split into smaller, more focused modules?**
  _Cohesion score 0.05491000227842333 - nodes in this community are weakly interconnected._
- **Why does `Dress rehearsal` connect `README: Pilot Features` to `Deploy Runbook & Public Routes`, `Hackathon Plan: Ingestion & Demo`, `Pilot Runbook & Go/No-Go`, `Deploy: Backups, Caddy, Env`?**
  _High betweenness centrality (0.189) - this node is a cross-community bridge._
- **Should `Drizzle DB Schema` be split into smaller, more focused modules?**
  _Cohesion score 0.03508771929824561 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Custom PDF/image reports available on all paid plans` and `Branded reports (logo + cover page) Team-only`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Buffer for Agencies landing page (Oct 2026)` and `Buffer site navigation and footer (Product, Resources, Support, Company, Legal)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._