ALTER TABLE `facts` ADD `claim_kind` text DEFAULT 'observed' NOT NULL;--> statement-breakpoint
ALTER TABLE `facts` ADD `billing_cadence` text;--> statement-breakpoint
ALTER TABLE `facts` ADD `availability` text;--> statement-breakpoint
ALTER TABLE `facts` ADD `attribution` text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE `hypotheses` ADD `claim_kind` text DEFAULT 'positive' NOT NULL;--> statement-breakpoint
ALTER TABLE `open_questions` ADD `kind` text DEFAULT 'investigation' NOT NULL;--> statement-breakpoint
ALTER TABLE `open_questions` ADD `fact_ids` text DEFAULT '[]' NOT NULL;