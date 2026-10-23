import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { emailOtps } from "../db/schema";
import { env } from "../env";
import { generateOtp, hmacOtp, safeEqualHex } from "./crypto";
import { errors } from "./errors";
import { sendOtpMail, type OtpPurpose } from "./mailer";

export async function issueOtp(input: {
  email: string;
  purpose: OtpPurpose;
  userId?: string | null;
  firstName: string;
}): Promise<void> {
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  // Hourly cap and resend cooldown in one round trip: every extra query is a
  // full network hop when the database is remote.
  const [usage] = await db
    .select({
      hourly: sql<number>`count(*) filter (where ${emailOtps.sentAt} >= ${hourAgo.toISOString()})`.mapWith(Number),
      lastSentAt: sql<Date | null>`max(${emailOtps.sentAt})`,
    })
    .from(emailOtps)
    .where(and(eq(emailOtps.email, input.email), eq(emailOtps.purpose, input.purpose)));

  if ((usage?.hourly ?? 0) >= env.OTP_HOURLY_LIMIT) {
    throw errors.otpCooldown(60 * 60);
  }

  if (usage?.lastSentAt) {
    const elapsed = (now.getTime() - new Date(usage.lastSentAt).getTime()) / 1000;
    if (elapsed < env.OTP_RESEND_COOLDOWN_SECONDS) {
      throw errors.otpCooldown(Math.ceil(env.OTP_RESEND_COOLDOWN_SECONDS - elapsed));
    }
  }

  const code = generateOtp();
  const id = randomUUID();

  // Only the newest code for a purpose may be valid. Both statements run
  // concurrently (the update excludes the new row, so order does not matter),
  // which halves the wall-clock cost of the two hops.
  await Promise.all([
    db.insert(emailOtps).values({
      id,
      email: input.email,
      userId: input.userId ?? null,
      purpose: input.purpose,
      codeHmac: hmacOtp(code),
      expiresAt: new Date(now.getTime() + env.OTP_TTL_SECONDS * 1000),
      sentAt: now,
    }),
    db
      .update(emailOtps)
      .set({ consumedAt: now })
      .where(
        and(
          eq(emailOtps.email, input.email),
          eq(emailOtps.purpose, input.purpose),
          isNull(emailOtps.consumedAt),
          ne(emailOtps.id, id),
        ),
      ),
  ]);

  sendOtpMail(input.email, code, input.purpose, input.firstName);
}

/**
 * Validates a code without consuming it: throws a typed AppError on any
 * failure, returns the row id on success. Callers that have other writes to do
 * can consume it concurrently with them.
 */
export async function checkOtp(input: {
  email: string;
  purpose: OtpPurpose;
  code: string;
}): Promise<string> {
  const [row] = await db
    .select()
    .from(emailOtps)
    .where(
      and(
        eq(emailOtps.email, input.email),
        eq(emailOtps.purpose, input.purpose),
        isNull(emailOtps.consumedAt),
      ),
    )
    .orderBy(desc(emailOtps.sentAt))
    .limit(1);

  if (!row) throw errors.otpInvalid();

  if (row.expiresAt.getTime() <= Date.now()) {
    await db
      .update(emailOtps)
      .set({ consumedAt: new Date() })
      .where(eq(emailOtps.id, row.id));
    throw errors.otpExpired();
  }

  if (row.attempts >= env.OTP_MAX_ATTEMPTS) throw errors.otpAttemptsExceeded();

  if (!safeEqualHex(row.codeHmac, hmacOtp(input.code))) {
    const attempts = row.attempts + 1;
    await db.update(emailOtps).set({ attempts }).where(eq(emailOtps.id, row.id));
    if (attempts >= env.OTP_MAX_ATTEMPTS) throw errors.otpAttemptsExceeded();
    throw errors.otpInvalid();
  }

  return row.id;
}

/** Marks a checked code as used. */
export async function consumeOtpRow(id: string): Promise<void> {
  await db.update(emailOtps).set({ consumedAt: new Date() }).where(eq(emailOtps.id, id));
}

/** Throws a typed AppError on any failure; returns normally on success. */
export async function consumeOtp(input: {
  email: string;
  purpose: OtpPurpose;
  code: string;
}): Promise<void> {
  await consumeOtpRow(await checkOtp(input));
}
