ALTER TABLE `company` ADD `website` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `company` ADD `onboarding` text;--> statement-breakpoint
ALTER TABLE `competitors` ADD `profile` text;--> statement-breakpoint
ALTER TABLE `competitors` ADD `emphasis` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `competitors` ADD `onboarded_at` text;