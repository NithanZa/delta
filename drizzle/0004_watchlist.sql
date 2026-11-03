CREATE TABLE `feeds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`competitor_id` integer NOT NULL,
	`url` text NOT NULL,
	`kind` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`etag` text,
	`last_modified` text,
	`last_checked_at` text,
	`last_item_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`competitor_id`) REFERENCES `competitors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feeds_competitor_url` ON `feeds` (`competitor_id`,`url`);--> statement-breakpoint
ALTER TABLE `competitors` ADD `domain` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `watch` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `check_interval_hours` integer DEFAULT 168 NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `last_checked_at` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `last_changed_at` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `last_error` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `note` text DEFAULT '' NOT NULL;