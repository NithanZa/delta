CREATE TABLE `company` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`product` text DEFAULT '' NOT NULL,
	`target_customers` text DEFAULT '' NOT NULL,
	`positioning` text DEFAULT '' NOT NULL,
	`priorities` text DEFAULT '' NOT NULL,
	`constraints` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `competitors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `competitors_slug_unique` ON `competitors` (`slug`);--> statement-breakpoint
CREATE TABLE `facts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`competitor_id` integer NOT NULL,
	`snapshot_id` integer NOT NULL,
	`statement` text NOT NULL,
	`quote` text NOT NULL,
	`category` text NOT NULL,
	`event_date` text,
	`importance` integer DEFAULT 3 NOT NULL,
	`is_change` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`competitor_id`) REFERENCES `competitors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `hypotheses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`competitor_id` integer NOT NULL,
	`dimension` text NOT NULL,
	`statement` text NOT NULL,
	`confidence` real NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_run_id` integer NOT NULL,
	`updated_run_id` integer NOT NULL,
	`supersedes_id` integer,
	`user_correction` text,
	FOREIGN KEY (`competitor_id`) REFERENCES `competitors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `hypothesis_updates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hypothesis_id` integer NOT NULL,
	`run_id` integer NOT NULL,
	`change` text NOT NULL,
	`prev_confidence` real,
	`new_confidence` real NOT NULL,
	`reasoning` text NOT NULL,
	`fact_ids` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`hypothesis_id`) REFERENCES `hypotheses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `insights` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`competitor_id` integer NOT NULL,
	`run_id` integer NOT NULL,
	`title` text NOT NULL,
	`what_happened` text NOT NULL,
	`what_it_means` text NOT NULL,
	`why_it_matters` text NOT NULL,
	`what_to_do_next` text NOT NULL,
	`severity` text NOT NULL,
	`hypothesis_ids` text DEFAULT '[]' NOT NULL,
	`fact_ids` text DEFAULT '[]' NOT NULL,
	`actions` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`user_correction` text,
	FOREIGN KEY (`competitor_id`) REFERENCES `competitors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `open_questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`competitor_id` integer NOT NULL,
	`created_run_id` integer NOT NULL,
	`question` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_run_id` integer,
	`resolution` text,
	FOREIGN KEY (`competitor_id`) REFERENCES `competitors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `research_questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`competitor_id` integer NOT NULL,
	`text` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`competitor_id`) REFERENCES `competitors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`competitor_id` integer NOT NULL,
	`label` text NOT NULL,
	`cutoff_date` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`started_at` text,
	`finished_at` text,
	`log` text DEFAULT '[]' NOT NULL,
	`stats` text DEFAULT '{}' NOT NULL,
	`error` text,
	FOREIGN KEY (`competitor_id`) REFERENCES `competitors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`competitor_id` integer NOT NULL,
	`url` text NOT NULL,
	`source_type` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`published_at` text NOT NULL,
	`fetched_at` text NOT NULL,
	`raw_html` text DEFAULT '' NOT NULL,
	`extracted_text` text NOT NULL,
	`content_hash` text NOT NULL,
	`archive_url` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`competitor_id`) REFERENCES `competitors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`competitor_id` integer NOT NULL,
	`url` text NOT NULL,
	`source_type` text NOT NULL,
	`provider` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`competitor_id`) REFERENCES `competitors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_competitor_url` ON `sources` (`competitor_id`,`url`);--> statement-breakpoint
CREATE TABLE `strategy_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`competitor_id` integer NOT NULL,
	`run_id` integer NOT NULL,
	`profile` text NOT NULL,
	FOREIGN KEY (`competitor_id`) REFERENCES `competitors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `timeline_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`competitor_id` integer NOT NULL,
	`run_id` integer NOT NULL,
	`event_date` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`fact_ids` text DEFAULT '[]' NOT NULL,
	`related_event_ids` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`competitor_id`) REFERENCES `competitors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
