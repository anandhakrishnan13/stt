import { randomUUID } from "node:crypto";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID());

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

export const users = sqliteTable(
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
    emailVerifiedAt: integer("email_verified_at", { mode: "timestamp_ms" }),
    tokenVersion: integer("token_version").notNull().default(0),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("users_email_idx").on(table.email)],
);

export const refreshTokens = sqliteTable(
  "refresh_tokens",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    familyId: text("family_id").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
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

export const emailOtps = sqliteTable(
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
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    sentAt: integer("sent_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    consumedAt: integer("consumed_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("email_otps_lookup_idx").on(table.email, table.purpose, table.sentAt)],
);

export const transcripts = sqliteTable(
  "transcripts",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    language: text("language"),
    engine: text("engine", { enum: ["gemini-live", "whisper-local"] }),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("transcripts_user_created_idx").on(table.userId, table.createdAt),
    index("transcripts_user_deleted_idx").on(table.userId, table.deletedAt),
  ],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: id(),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    target: text("target"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (table) => [index("audit_events_actor_idx").on(table.actorUserId)],
);

export type UserRow = typeof users.$inferSelect;
export type RefreshTokenRow = typeof refreshTokens.$inferSelect;

export type TranscriptRow = typeof transcripts.$inferSelect;
