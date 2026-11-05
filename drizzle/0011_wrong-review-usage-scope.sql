ALTER TABLE `reactions` ADD `reviewed_at` text;--> statement-breakpoint
ALTER TABLE `reactions` ADD `review_outcome` text;--> statement-breakpoint
ALTER TABLE `reactions` ADD `review_note` text;--> statement-breakpoint
ALTER TABLE `usage_events` ADD `competitor_id` integer;--> statement-breakpoint
ALTER TABLE `usage_events` ADD `run_id` integer;