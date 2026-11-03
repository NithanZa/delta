CREATE TABLE `usage_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`service` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`task` text NOT NULL,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `usage_events_created_at` ON `usage_events` (`created_at`);