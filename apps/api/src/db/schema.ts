import { randomUUID } from "node:crypto";
import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID());

const createdAt = () =>
  timestamp("created_at", { withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date());

/** Postgres has no native Drizzle bytea column; chunks are stored as Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull().unique(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    status: text("status", { enum: ["unverified", "active", "suspended"] })
      .notNull()
      .default("unverified"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    tokenVersion: integer("token_version").notNull().default(0),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    familyId: text("family_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedBy: text("replaced_by"),
    userAgent: text("user_agent"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (table) => [
    index("refresh_tokens_user_idx").on(table.userId),
    index("refresh_tokens_family_idx").on(table.familyId),
  ],
);

export const emailOtps = pgTable(
  "email_otps",
  {
    id: id(),
    email: text("email").notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    purpose: text("purpose", {
      enum: ["verify_email", "password_change", "password_reset"],
    }).notNull(),
    codeHmac: text("code_hmac").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [index("email_otps_lookup_idx").on(table.email, table.purpose, table.sentAt)],
);

export const transcripts = pgTable(
  "transcripts",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status", { enum: ["recording", "ready", "failed"] })
      .notNull()
      .default("ready"),
    language: text("language"),
    engine: text("engine", { enum: ["groq-whisper", "gemini-live", "whistle"] }),
    durationMs: integer("duration_ms").notNull().default(0),
    audioKey: text("audio_key"),
    audioMime: text("audio_mime"),
    audioBytes: integer("audio_bytes").notNull().default(0),
    chunkSeq: integer("chunk_seq").notNull().default(-1),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("transcripts_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const recordingChunks = pgTable(
  "recording_chunks",
  {
    transcriptId: text("transcript_id")
      .notNull()
      .references(() => transcripts.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    bytes: bytea("bytes").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.transcriptId, table.seq] }),
  ],
);

export const segments = pgTable(
  "segments",
  {
    id: id(),
    transcriptId: text("transcript_id")
      .notNull()
      .references(() => transcripts.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    text: text("text").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("segments_transcript_seq_idx").on(table.transcriptId, table.seq)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    target: text("target"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
);

export type UserRow = typeof users.$inferSelect;
export type RefreshTokenRow = typeof refreshTokens.$inferSelect;

export type TranscriptRow = typeof transcripts.$inferSelect;
export type RecordingChunkRow = typeof recordingChunks.$inferSelect;
