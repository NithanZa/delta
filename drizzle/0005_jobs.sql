CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`competitor_id` integer,
	`status` text DEFAULT 'queued' NOT NULL,
	`requested_by` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`log` text DEFAULT '[]' NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`competitor_id`) REFERENCES `competitors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `runs` ADD `kind` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
UPDATE `runs` SET `kind` = 'replay' WHERE `label` IN ('Run 1', 'Run 2', 'Run 3');