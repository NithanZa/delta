ALTER TABLE `insights` ADD `score` real;--> statement-breakpoint
ALTER TABLE `insights` ADD `score_breakdown` text;--> statement-breakpoint
ALTER TABLE `insights` ADD `relevance_note` text;--> statement-breakpoint
ALTER TABLE `insights` ADD `actionability` integer;--> statement-breakpoint
ALTER TABLE `insights` ADD `supersedes_insight_id` integer;--> statement-breakpoint
ALTER TABLE `insights` ADD `fingerprint` text;--> statement-breakpoint
CREATE INDEX `insights_competitor_status` ON `insights` (`competitor_id`,`status`);