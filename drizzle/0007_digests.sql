CREATE TABLE `digest_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`digest_id` integer NOT NULL,
	`competitor_id` integer NOT NULL,
	`insight_id` integer NOT NULL,
	`rank` integer NOT NULL,
	FOREIGN KEY (`digest_id`) REFERENCES `digests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`competitor_id`) REFERENCES `competitors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`insight_id`) REFERENCES `insights`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `digests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sequence` integer NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`channel` text DEFAULT 'email' NOT NULL,
	`subject` text NOT NULL,
	`html` text NOT NULL,
	`text` text NOT NULL,
	`content` text NOT NULL,
	`recipients` text DEFAULT '[]' NOT NULL,
	`sent_at` text,
	`provider_message_id` text,
	`error` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`props` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inbound_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider_email_id` text NOT NULL,
	`from_email` text NOT NULL,
	`to_email` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`text` text,
	`html` text,
	`received_at` text NOT NULL,
	`digest_id` integer,
	`status` text DEFAULT 'received' NOT NULL,
	`result` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbound_messages_provider_email_id_unique` ON `inbound_messages` (`provider_email_id`);--> statement-breakpoint
CREATE TABLE `reactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`insight_id` integer NOT NULL,
	`digest_id` integer,
	`kind` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`source` text NOT NULL,
	`actor_email` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`insight_id`) REFERENCES `insights`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`digest_id`) REFERENCES `digests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reactions_insight_digest_kind` ON `reactions` (`insight_id`,`digest_id`,`kind`);