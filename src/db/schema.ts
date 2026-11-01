import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const PROVIDERS = ["seeded", "manual_url", "search"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const RUN_STATUSES = ["queued", "running", "done", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

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

export const SEVERITIES = ["high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const INSIGHT_STATUSES = ["new", "acknowledged", "dismissed"] as const;
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
  wallMs?: number;
};
export type InsightAction = { type: "respond" | "investigate"; text: string; rationale: string };
export type ProfileDimension = { summary: string; confidence: number; factIds: number[] };
export type StrategyProfileJson = {
  customers: ProfileDimension;
  productDirection: ProfileDimension;
  positioning: ProfileDimension;
  distribution: ProfileDimension;
  businessModel: ProfileDimension;
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
  updatedAt: text("updated_at").notNull().$defaultFn(now),
});

export const competitors = sqliteTable("competitors", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  website: text("website").notNull().default(""),
  description: text("description").notNull().default(""),
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
  },
  (t) => [uniqueIndex("sources_competitor_url").on(t.competitorId, t.url)],
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
});

export const runs = sqliteTable("runs", {
  id: id(),
  competitorId: integer("competitor_id").notNull().references(() => competitors.id),
  label: text("label").notNull(),
  cutoffDate: text("cutoff_date").notNull(),
  status: text("status", { enum: RUN_STATUSES }).notNull().default("queued"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  log: text("log", { mode: "json" }).$type<RunLogEntry[]>().notNull().default([]),
  stats: text("stats", { mode: "json" }).$type<RunStats>().notNull().default({}),
  error: text("error"),
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

export const insights = sqliteTable("insights", {
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
});

export const openQuestions = sqliteTable("open_questions", {
  id: id(),
  competitorId: integer("competitor_id").notNull().references(() => competitors.id),
  createdRunId: integer("created_run_id").notNull().references(() => runs.id),
  question: text("question").notNull(),
  status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
  resolvedRunId: integer("resolved_run_id"),
  resolution: text("resolution"),
});

export type Company = typeof company.$inferSelect;
export type Competitor = typeof competitors.$inferSelect;
export type ResearchQuestion = typeof researchQuestions.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type Snapshot = typeof snapshots.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type Fact = typeof facts.$inferSelect;
export type TimelineEvent = typeof timelineEvents.$inferSelect;
export type Hypothesis = typeof hypotheses.$inferSelect;
export type HypothesisUpdate = typeof hypothesisUpdates.$inferSelect;
export type StrategyProfile = typeof strategyProfiles.$inferSelect;
export type Insight = typeof insights.$inferSelect;
export type OpenQuestion = typeof openQuestions.$inferSelect;
