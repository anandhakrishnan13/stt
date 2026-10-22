CREATE TABLE "recording_chunks" (
	"transcript_id" text NOT NULL,
	"seq" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "recording_chunks_transcript_id_seq_pk" PRIMARY KEY("transcript_id","seq")
);
--> statement-breakpoint
ALTER TABLE "recording_chunks" ADD CONSTRAINT "recording_chunks_transcript_id_transcripts_id_fk" FOREIGN KEY ("transcript_id") REFERENCES "public"."transcripts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recording_chunks_created_idx" ON "recording_chunks" USING btree ("created_at");