CREATE TABLE `absence_checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`competitor_id` integer NOT NULL,
	`topic` text NOT NULL,
	`queries` text DEFAULT '[]' NOT NULL,
	`urls_checked` text DEFAULT '[]' NOT NULL,
	`result` text NOT NULL,
	`snapshot_id` integer,
	`fact_id` integer,
	`checked_at` text NOT NULL,
	FOREIGN KEY (`competitor_id`) REFERENCES `competitors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `sources` ADD `discovery_query` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `relevance_note` text;