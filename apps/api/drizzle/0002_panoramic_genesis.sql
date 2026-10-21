ALTER TABLE `transcripts` ADD `status` text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE `transcripts` ADD `audio_key` text;--> statement-breakpoint
ALTER TABLE `transcripts` ADD `audio_mime` text;--> statement-breakpoint
ALTER TABLE `transcripts` ADD `audio_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transcripts` ADD `chunk_seq` integer DEFAULT -1 NOT NULL;--> statement-breakpoint
ALTER TABLE `transcripts` ADD `ended_at` integer;