CREATE TABLE `segments` (
	`id` text PRIMARY KEY NOT NULL,
	`transcript_id` text NOT NULL,
	`seq` integer NOT NULL,
	`text` text NOT NULL,
	`start_ms` integer NOT NULL,
	`end_ms` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`transcript_id`) REFERENCES `transcripts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `segments_transcript_seq_idx` ON `segments` (`transcript_id`,`seq`);