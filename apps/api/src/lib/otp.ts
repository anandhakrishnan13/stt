import { and, count, desc, eq, gte, isNull } from "drizzle-orm";
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

  const [recent] = await db
    .select({ total: count() })
    .from(emailOtps)
    .where(
      and(
        eq(emailOtps.email, input.email),
        eq(emailOtps.purpose, input.purpose),
        gte(emailOtps.sentAt, hourAgo),
      ),
    );

  if ((recent?.total ?? 0) >= env.OTP_HOURLY_LIMIT) {
    throw errors.otpCooldown(60 * 60);
  }

  const [last] = await db
    .select({ sentAt: emailOtps.sentAt })
    .from(emailOtps)
    .where(and(eq(emailOtps.email, input.email), eq(emailOtps.purpose, input.purpose)))
    .orderBy(desc(emailOtps.sentAt))
    .limit(1);

  if (last) {
    const elapsed = (now.getTime() - last.sentAt.getTime()) / 1000;
    if (elapsed < env.OTP_RESEND_COOLDOWN_SECONDS) {
      throw errors.otpCooldown(Math.ceil(env.OTP_RESEND_COOLDOWN_SECONDS - elapsed));
    }
  }

  // Only the newest code for a purpose may be valid.
  await db
    .update(emailOtps)
    .set({ consumedAt: now })
    .where(
      and(
        eq(emailOtps.email, input.email),
        eq(emailOtps.purpose, input.purpose),
        isNull(emailOtps.consumedAt),
      ),
    );

  const code = generateOtp();
  const [row] = await db
    .insert(emailOtps)
    .values({
      email: input.email,
      userId: input.userId ?? null,
      purpose: input.purpose,
      codeHmac: hmacOtp(code),
      expiresAt: new Date(now.getTime() + env.OTP_TTL_SECONDS * 1000),
      sentAt: now,
    })
    .returning({ id: emailOtps.id });

  try {
    await sendOtpMail(input.email, code, input.purpose, input.firstName);
  } catch (error) {
    if (row) await db.delete(emailOtps).where(eq(emailOtps.id, row.id));
    console.error("[otp] delivery failed", error);
    throw errors.internal();
  }
}

/** Throws a typed AppError on any failure; returns normally on success. */
export async function consumeOtp(input: {
  email: string;
  purpose: OtpPurpose;
  code: string;
}): Promise<void> {
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

  await db
    .update(emailOtps)
    .set({ consumedAt: new Date() })
    .where(eq(emailOtps.id, row.id));
}
