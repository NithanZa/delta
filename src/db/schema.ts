import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { LlmRole, LlmUsage } from "@/lib/llm/client";

const id = () => integer("id").primaryKey({ autoIncrement: true });
const now = () => new Date().toISOString();

export const SOURCE_TYPES = [
  "blog",
  "release_notes",
  "pricing",
  "docs",
  "website",
  "jobs",
  "customer_story",
  "press",
  "interview",
  "other",
  /** A note the partner sent Delta (email reply); never a public page. */
  "internal",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const DIGEST_STATUSES = ["draft", "held", "sent", "failed"] as const;
export type DigestStatus = (typeof DIGEST_STATUSES)[number];
export const DIGEST_CHANNELS = ["email", "slack"] as const;
export const REACTION_KINDS = ["useful", "wrong", "acted_on"] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];
export const REACTION_SOURCES = ["email", "dashboard", "reply"] as const;
export const EVENT_NAMES = ["digest_sent", "insight_viewed", "insight_reacted", "insight_corrected", "source_added", "reply_received", "decision_influenced"] as const;
export type EventName = (typeof EVENT_NAMES)[number];
export const INBOUND_STATUSES = ["received", "processed", "ignored", "failed"] as const;

/** How a page entered the record: curated corpus, pasted URL, search API, watchlist re-crawl, feed/sitemap poll, Exa discovery, Wayback backfill, partner-supplied note. */
export const PROVIDERS = ["seeded", "manual_url", "search", "watchlist", "feed", "discovery", "backfill", "internal"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const FEED_KINDS = ["rss", "atom", "sitemap", "sitemap_index"] as const;
export type FeedKind = (typeof FEED_KINDS)[number];

export const RUN_STATUSES = ["queued", "running", "done", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** replay = the dated demo presets; manual = started from the UI/CLI; scheduled = the worker's weekly run; backfill = Wayback history (phase 10). */
export const RUN_KINDS = ["replay", "manual", "scheduled", "backfill", "check"] as const;
export type RunKind = (typeof RUN_KINDS)[number];

export const JOB_KINDS = ["crawl", "run", "digest", "discovery", "backfill", "backup"] as const;
export type JobKind = (typeof JOB_KINDS)[number];
export const JOB_STATUSES = ["queued", "running", "done", "failed", "skipped"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JOB_REQUESTERS = ["schedule", "ui", "cli"] as const;
export type JobRequester = (typeof JOB_REQUESTERS)[number];

export const FACT_CATEGORIES = [
  "segment",
  "product",
  "pricing",
  "distribution",
  "partnership",
  "hiring",
  "messaging",
  "other",
] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];

export const DIMENSIONS = [
  "customers",
  "product",
  "positioning",
  "distribution",
  "business_model",
  "next_moves",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const HYPOTHESIS_STATUSES = [
  "active",
  "strengthened",
  "weakened",
  "contradicted",
  "revised",
  "retired",
] as const;
export type HypothesisStatus = (typeof HYPOTHESIS_STATUSES)[number];

export const HYPOTHESIS_CHANGES = [
  "created",
  "strengthened",
  "weakened",
  "contradicted",
  "revised",
  "retired",
] as const;
export type HypothesisChange = (typeof HYPOTHESIS_CHANGES)[number];

/** observed = extracted from a page; absence = an explicit check found nothing (phase 8). */
export const CLAIM_KINDS = ["observed", "absence"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export const BILLING_CADENCES = ["monthly", "annual", "one_time", "unknown"] as const;
export type BillingCadence = (typeof BILLING_CADENCES)[number];

export const AVAILABILITIES = ["shipped", "announced", "coming_soon", "beta", "deprecated", "unknown"] as const;
export type Availability = (typeof AVAILABILITIES)[number];

/** positive = the competitor does/has X; absence = the competitor lacks X. */
export const HYPOTHESIS_CLAIM_KINDS = ["positive", "absence"] as const;
export type HypothesisClaimKind = (typeof HYPOTHESIS_CLAIM_KINDS)[number];

export const QUESTION_KINDS = ["investigation", "conflict"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const SEVERITIES = ["high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** superseded = replaced by a newer insight on the same topic (see insights.supersedesInsightId on the replacement). */
export const INSIGHT_STATUSES = ["new", "acknowledged", "dismissed", "superseded"] as const;
export type InsightStatus = (typeof INSIGHT_STATUSES)[number];

export type RunLogEntry = { ts: string; level: "info" | "warn" | "error"; message: string };
export type RunStats = {
  snapshots?: number;
  facts?: number;
  changes?: number;
  hypothesesUpdated?: number;
  insights?: number;
  promptTokens?: number;
  completionTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Token usage per model role (extract: facts + changes; synthesize: synthesis + insights). */
  byRole?: Partial<Record<LlmRole, LlmUsage>>;
  /** Model id per role at the time of the run. */
  models?: Partial<Record<LlmRole, string>>;
  /** Estimated USD from list prices; null when a model has no known price. */
  costUsd?: number | null;
  wallMs?: number;
};
export type InsightAction = { type: "respond" | "investigate"; text: string; rationale: string };
/** Components of an insight's score, each in [0, 1] (relevance and actionability are the 1–5 ratings divided by 5). */
export type ScoreBreakdown = { relevance: number; novelty: number; evidence: number; actionability: number };
export type ProfileDimension = { summary: string; confidence: number; factIds: number[] };
export type StrategyProfileJson = {
  customers: ProfileDimension;
  productDirection: ProfileDimension;
  positioning: ProfileDimension;
  distribution: ProfileDimension;
  businessModel: ProfileDimension;
};

/** What onboarding drafted and asked; answers are also folded into the profile fields. */
export type OnboardingRecord = {
  draftedAt: string;
  sourceUrls: string[];
  questions: { question: string; whyItMatters: string; field: string; answer: string }[];
};

/** A competitor profile drafted from its own site; each field carries the drafter's confidence. */
export type CompetitorProfile = {
  segments: { text: string; confidence: number };
  pricingModel: { text: string; confidence: number };
  positioning: { text: string; confidence: number };
  distribution: { text: string; confidence: number };
  notable: { text: string; confidence: number };
};

export const company = sqliteTable("company", {
  id: id(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  product: text("product").notNull().default(""),
  targetCustomers: text("target_customers").notNull().default(""),
  positioning: text("positioning").notNull().default(""),
  priorities: text("priorities").notNull().default(""),
  constraints: text("constraints").notNull().default(""),
  website: text("website").notNull().default(""),
  onboarding: text("onboarding", { mode: "json" }).$type<OnboardingRecord>(),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
});

export const competitors = sqliteTable("competitors", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  website: text("website").notNull().default(""),
  description: text("description").notNull().default(""),
  /** Hostname of `website` without "www."; feeds and sitemaps only admit URLs on this domain or its subdomains. */
  domain: text("domain").notNull().default(""),
  profile: text("profile", { mode: "json" }).$type<CompetitorProfile>(),
  /** What the partner asked Delta to emphasise about this competitor. */
  emphasis: text("emphasis").notNull().default(""),
  onboardedAt: text("onboarded_at"),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

export const researchQuestions = sqliteTable("research_questions", {
  id: id(),
  competitorId: integer("competitor_id").notNull().references(() => competitors.id),
  text: text("text").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

export const sources = sqliteTable(
  "sources",
  {
    id: id(),
    competitorId: integer("competitor_id").notNull().references(() => competitors.id),
    url: text("url").notNull(),
    sourceType: text("source_type", { enum: SOURCE_TYPES }).notNull(),
    provider: text("provider", { enum: PROVIDERS }).notNull(),
    title: text("title").notNull().default(""),
    /** Re-fetch this page on an interval (watchlist). */
    watch: integer("watch", { mode: "boolean" }).notNull().default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    checkIntervalHours: integer("check_interval_hours").notNull().default(168),
    lastCheckedAt: text("last_checked_at"),
    lastChangedAt: text("last_changed_at"),
    lastError: text("last_error"),
    note: text("note").notNull().default(""),
    /** The search query that surfaced a discovered page. */
    discoveryQuery: text("discovery_query"),
    /** Why the relevance gate kept it. */
    relevanceNote: text("relevance_note"),
  },
  (t) => [uniqueIndex("sources_competitor_url").on(t.competitorId, t.url)],
);

export const ABSENCE_TOPICS = ["partner_program", "enterprise_tier", "public_api", "sso_saml", "white_label", "marketplace", "free_plan"] as const;
export type AbsenceTopic = (typeof ABSENCE_TOPICS)[number];
export const ABSENCE_RESULTS = ["found", "not_found", "superseded"] as const;

/** An explicit check that something does (not) exist on the competitor's site; the basis for absence claims above 0.4. */
export const absenceChecks = sqliteTable("absence_checks", {
  id: id(),
  competitorId: integer("competitor_id").notNull().references(() => competitors.id),
  topic: text("topic", { enum: ABSENCE_TOPICS }).notNull(),
  queries: text("queries", { mode: "json" }).$type<string[]>().notNull().default([]),
  urlsChecked: text("urls_checked", { mode: "json" }).$type<string[]>().notNull().default([]),
  result: text("result", { enum: ABSENCE_RESULTS }).notNull(),
  snapshotId: integer("snapshot_id"),
  factId: integer("fact_id"),
  checkedAt: text("checked_at").notNull().$defaultFn(now),
});

/** RSS/Atom feeds and sitemaps polled for new pages on the competitor's domain. */
export const feeds = sqliteTable(
  "feeds",
  {
    id: id(),
    competitorId: integer("competitor_id").notNull().references(() => competitors.id),
    url: text("url").notNull(),
    kind: text("kind", { enum: FEED_KINDS }).notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    etag: text("etag"),
    lastModified: text("last_modified"),
    lastCheckedAt: text("last_checked_at"),
    /** Newest item date seen so far (YYYY-MM-DD); items up to this date are considered known. */
    lastItemAt: text("last_item_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex("feeds_competitor_url").on(t.competitorId, t.url)],
);

export const snapshots = sqliteTable("snapshots", {
  id: id(),
  sourceId: integer("source_id").notNull().references(() => sources.id),
  competitorId: integer("competitor_id").notNull().references(() => competitors.id),
  url: text("url").notNull(),
  sourceType: text("source_type", { enum: SOURCE_TYPES }).notNull(),
  title: text("title").notNull().default(""),
  publishedAt: text("published_at").notNull(),
  fetchedAt: text("fetched_at").notNull(),
  rawHtml: text("raw_html").notNull().default(""),
  extractedText: text("extracted_text").notNull(),
  contentHash: text("content_hash").notNull(),
  archiveUrl: text("archive_url"),
  /** Set once a run has extracted facts from this snapshot (null = pending). */
  processedRunId: integer("processed_run_id"),
});

export const runs = sqliteTable("runs", {
  id: id(),
  competitorId: integer("competitor_id").notNull().references(() => competitors.id),
  label: text("label").notNull(),
  cutoffDate: text("cutoff_date").notNull(),
  kind: text("kind", { enum: RUN_KINDS }).notNull().default("manual"),
  status: text("status", { enum: RUN_STATUSES }).notNull().default("queued"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  log: text("log", { mode: "json" }).$type<RunLogEntry[]>().notNull().default([]),
  stats: text("stats", { mode: "json" }).$type<RunStats>().notNull().default({}),
  error: text("error"),
});

/** Key/value settings edited from the UI (schedule, digest recipients, worker heartbeat). */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
});

/** Work queued for the worker process: scheduled ticks and "run now" buttons. */
export const jobs = sqliteTable("jobs", {
  id: id(),
  kind: text("kind", { enum: JOB_KINDS }).notNull(),
  competitorId: integer("competitor_id").references(() => competitors.id),
  status: text("status", { enum: JOB_STATUSES }).notNull().default("queued"),
  requestedBy: text("requested_by", { enum: JOB_REQUESTERS }).notNull(),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  log: text("log", { mode: "json" }).$type<RunLogEntry[]>().notNull().default([]),
  error: text("error"),
  createdAt: text("created_at").notNull().$defaultFn(now),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
});

export const facts = sqliteTable("facts", {
  id: id(),
  runId: integer("run_id").notNull().references(() => runs.id),
  competitorId: integer("competitor_id").notNull().references(() => competitors.id),
  snapshotId: integer("snapshot_id").notNull().references(() => snapshots.id),
  statement: text("statement").notNull(),
  quote: text("quote").notNull(),
  category: text("category", { enum: FACT_CATEGORIES }).notNull(),
  eventDate: text("event_date"),
  importance: integer("importance").notNull().default(3),
  isChange: integer("is_change", { mode: "boolean" }).notNull().default(false),
  claimKind: text("claim_kind", { enum: CLAIM_KINDS }).notNull().default("observed"),
  /** Only meaningful for price facts; null otherwise. */
  billingCadence: text("billing_cadence", { enum: BILLING_CADENCES }),
  /** Only meaningful for capability facts; null otherwise. */
  availability: text("availability", { enum: AVAILABILITIES }),
  /** "public" for pages; "internal:<sender>" for partner-supplied notes (phase 7). */
  attribution: text("attribution").notNull().default("public"),
});

export const timelineEvents = sqliteTable("timeline_events", {
  id: id(),
  competitorId: integer("competitor_id").notNull().references(() => competitors.id),
  runId: integer("run_id").notNull().references(() => runs.id),
  eventDate: text("event_date").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  factIds: text("fact_ids", { mode: "json" }).$type<number[]>().notNull().default([]),
  relatedEventIds: text("related_event_ids", { mode: "json" }).$type<number[]>().notNull().default([]),
});

export const hypotheses = sqliteTable("hypotheses", {
  id: id(),
  competitorId: integer("competitor_id").notNull().references(() => competitors.id),
  dimension: text("dimension", { enum: DIMENSIONS }).notNull(),
  statement: text("statement").notNull(),
  confidence: real("confidence").notNull(),
  status: text("status", { enum: HYPOTHESIS_STATUSES }).notNull().default("active"),
  createdRunId: integer("created_run_id").notNull().references(() => runs.id),
  updatedRunId: integer("updated_run_id").notNull().references(() => runs.id),
  supersedesId: integer("supersedes_id"),
  userCorrection: text("user_correction"),
  /** The run whose synthesis acknowledged the current correction (null = not yet applied). */
  correctionAppliedRunId: integer("correction_applied_run_id"),
  claimKind: text("claim_kind", { enum: HYPOTHESIS_CLAIM_KINDS }).notNull().default("positive"),
});

export const hypothesisUpdates = sqliteTable("hypothesis_updates", {
  id: id(),
  hypothesisId: integer("hypothesis_id").notNull().references(() => hypotheses.id),
  runId: integer("run_id").notNull().references(() => runs.id),
  change: text("change", { enum: HYPOTHESIS_CHANGES }).notNull(),
  prevConfidence: real("prev_confidence"),
  newConfidence: real("new_confidence").notNull(),
  reasoning: text("reasoning").notNull(),
  factIds: text("fact_ids", { mode: "json" }).$type<number[]>().notNull().default([]),
});

export const strategyProfiles = sqliteTable("strategy_profiles", {
  id: id(),
  competitorId: integer("competitor_id").notNull().references(() => competitors.id),
  runId: integer("run_id").notNull().references(() => runs.id),
  profile: text("profile", { mode: "json" }).$type<StrategyProfileJson>().notNull(),
});

export const insights = sqliteTable(
  "insights",
  {
    id: id(),
    competitorId: integer("competitor_id").notNull().references(() => competitors.id),
    runId: integer("run_id").notNull().references(() => runs.id),
    title: text("title").notNull(),
    whatHappened: text("what_happened").notNull(),
    whatItMeans: text("what_it_means").notNull(),
    whyItMatters: text("why_it_matters").notNull(),
    whatToDoNext: text("what_to_do_next").notNull(),
    severity: text("severity", { enum: SEVERITIES }).notNull(),
    hypothesisIds: text("hypothesis_ids", { mode: "json" }).$type<number[]>().notNull().default([]),
    factIds: text("fact_ids", { mode: "json" }).$type<number[]>().notNull().default([]),
    actions: text("actions", { mode: "json" }).$type<InsightAction[]>().notNull().default([]),
    status: text("status", { enum: INSIGHT_STATUSES }).notNull().default("new"),
    userCorrection: text("user_correction"),
    /** 0–1, relevance 35% · novelty 25% · evidence 25% · actionability 15%; null for insights written before phase 6. */
    score: real("score"),
    scoreBreakdown: text("score_breakdown", { mode: "json" }).$type<ScoreBreakdown>(),
    /** Which company priority or constraint the insight touches, in the model's words. */
    relevanceNote: text("relevance_note"),
    /** 1–5 as rated by the model. */
    actionability: integer("actionability"),
    /** The insight this one replaces (that row's status is superseded). */
    supersedesInsightId: integer("supersedes_insight_id"),
    fingerprint: text("fingerprint"),
  },
  (t) => [index("insights_competitor_status").on(t.competitorId, t.status)],
);

/** One weekly email (or Slack post) and the content model it was rendered from. */
export const digests = sqliteTable("digests", {
  id: id(),
  /** 1, 2, 3… per channel; the fourth digest carries the 30-day question (phase 12). */
  sequence: integer("sequence").notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  status: text("status", { enum: DIGEST_STATUSES }).notNull().default("draft"),
  channel: text("channel", { enum: DIGEST_CHANNELS }).notNull().default("email"),
  subject: text("subject").notNull(),
  html: text("html").notNull(),
  text: text("text").notNull(),
  content: text("content", { mode: "json" }).$type<unknown>().notNull(),
  recipients: text("recipients", { mode: "json" }).$type<string[]>().notNull().default([]),
  sentAt: text("sent_at"),
  providerMessageId: text("provider_message_id"),
  error: text("error"),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

export const digestItems = sqliteTable("digest_items", {
  id: id(),
  digestId: integer("digest_id").notNull().references(() => digests.id),
  competitorId: integer("competitor_id").notNull().references(() => competitors.id),
  insightId: integer("insight_id").notNull().references(() => insights.id),
  rank: integer("rank").notNull(),
});

/** Useful / Wrong / Acted on, from a digest link, the dashboard or an email reply. */
export const reactions = sqliteTable(
  "reactions",
  {
    id: id(),
    insightId: integer("insight_id").notNull().references(() => insights.id),
    digestId: integer("digest_id").references(() => digests.id),
    kind: text("kind", { enum: REACTION_KINDS }).notNull(),
    note: text("note").notNull().default(""),
    source: text("source", { enum: REACTION_SOURCES }).notNull(),
    actorEmail: text("actor_email"),
    createdAt: text("created_at").notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex("reactions_insight_digest_kind").on(t.insightId, t.digestId, t.kind)],
);

/** Instrumentation: the five signals that tell us whether Delta influenced a decision. */
export const events = sqliteTable("events", {
  id: id(),
  name: text("name", { enum: EVENT_NAMES }).notNull(),
  props: text("props", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  createdAt: text("created_at").notNull().$defaultFn(now),
});

/** One row per paid API call, wherever it came from; `runs.stats` only covers calls made inside a run. */
export const usageEvents = sqliteTable(
  "usage_events",
  {
    id: id(),
    service: text("service", { enum: ["llm", "exa"] }).notNull(),
    /** Who bills it, e.g. openai.com, anthropic.com, exa.ai. */
    provider: text("provider").notNull(),
    /** Model id, or the endpoint for Exa. */
    model: text("model").notNull(),
    task: text("task").notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    /** Fixed when the call is made so later price changes do not rewrite history. Null when the model has no known price. */
    costUsd: real("cost_usd"),
    createdAt: text("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("usage_events_created_at").on(t.createdAt)],
);

/** Email replies received through the provider webhook. */
export const inboundMessages = sqliteTable("inbound_messages", {
  id: id(),
  providerEmailId: text("provider_email_id").notNull().unique(),
  fromEmail: text("from_email").notNull(),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull().default(""),
  text: text("text"),
  html: text("html"),
  receivedAt: text("received_at").notNull(),
  digestId: integer("digest_id"),
  status: text("status", { enum: INBOUND_STATUSES }).notNull().default("received"),
  result: text("result", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
});

export const openQuestions = sqliteTable("open_questions", {
  id: id(),
  competitorId: integer("competitor_id").notNull().references(() => competitors.id),
  createdRunId: integer("created_run_id").notNull().references(() => runs.id),
  question: text("question").notNull(),
  status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
  resolvedRunId: integer("resolved_run_id"),
  resolution: text("resolution"),
  kind: text("kind", { enum: QUESTION_KINDS }).notNull().default("investigation"),
  /** Facts a conflict question rests on (both sides of the disagreement). */
  factIds: text("fact_ids", { mode: "json" }).$type<number[]>().notNull().default([]),
});

export type Company = typeof company.$inferSelect;
export type Competitor = typeof competitors.$inferSelect;
export type ResearchQuestion = typeof researchQuestions.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type Feed = typeof feeds.$inferSelect;
export type AbsenceCheck = typeof absenceChecks.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type Digest = typeof digests.$inferSelect;
export type DigestItem = typeof digestItems.$inferSelect;
export type Reaction = typeof reactions.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type UsageEvent = typeof usageEvents.$inferSelect;
export type InboundMessage = typeof inboundMessages.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Snapshot = typeof snapshots.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type Fact = typeof facts.$inferSelect;
export type TimelineEvent = typeof timelineEvents.$inferSelect;
export type Hypothesis = typeof hypotheses.$inferSelect;
export type HypothesisUpdate = typeof hypothesisUpdates.$inferSelect;
export type StrategyProfile = typeof strategyProfiles.$inferSelect;
export type Insight = typeof insights.$inferSelect;
export type OpenQuestion = typeof openQuestions.$inferSelect;
