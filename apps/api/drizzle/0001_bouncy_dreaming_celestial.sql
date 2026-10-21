CREATE TABLE `transcripts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`language` text,
	`engine` text,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `transcripts_user_created_idx` ON `transcripts` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `transcripts_user_deleted_idx` ON `transcripts` (`user_id`,`deleted_at`);