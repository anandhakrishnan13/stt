import {
  loginSchema,
  resendOtpSchema,
  signupSchema,
  verifyEmailSchema,
  type UserDTO,
} from "@stt/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db";
import { users, type UserRow } from "../db/schema";
import { recordAudit } from "../lib/audit";
import { requireAuth } from "../lib/auth-guard";
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from "../lib/cookies";
import {
  hashPassword,
  verifyAgainstDummy,
  verifyPassword,
} from "../lib/crypto";
import { env } from "../env";
import { AppError, errors } from "../lib/errors";
import { parseBody } from "../lib/http";
import { limits } from "../lib/limits";
import { sendAccountExistsMail } from "../lib/mailer";
import { consumeOtp, issueOtp } from "../lib/otp";
import {
  findLiveUser,
  issueRefreshToken,
  revokeAllForUser,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
} from "../lib/tokens";

function toDTO(user: UserRow): UserDTO {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

async function startSession(
  reply: FastifyReply,
  user: Pick<UserRow, "id" | "tokenVersion">,
  request: FastifyRequest,
): Promise<void> {
  const accessToken = await signAccessToken(user);
  const refreshToken = await issueRefreshToken({
    userId: user.id,
    ip: request.ip,
    userAgent: request.headers["user-agent"] ?? null,
  });
  setAuthCookies(reply, { accessToken, refreshToken });
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "23505") return true;
  // drizzle wraps query failures in DrizzleQueryError; postgres.js keeps the
  // SQLSTATE on the PostgresError, which arrives as `cause`.
  if (!("cause" in error)) return false;
  const cause = error.cause;
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === "23505"
  );
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/signup", { config: { rateLimit: limits.signup } }, async (request, reply) => {
    const input = parseBody(signupSchema, request.body);

    const [existing] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);

    if (existing) {
      // Never reveal whether the address exists.
      if (!existing.deletedAt && existing.status === "unverified") {
        await issueOtp({
          email: existing.email,
          purpose: "verify_email",
          userId: existing.id,
          firstName: existing.firstName,
        }).catch((error: unknown) => {
          if (error instanceof AppError && error.code === "OTP_COOLDOWN") return;
          throw error;
        });
      } else if (!existing.deletedAt && existing.emailVerifiedAt) {
        await sendAccountExistsMail(existing.email, existing.firstName).catch(() => {});
      }
      await recordAudit({
        action: "signup_existing_email",
        target: input.email,
        ip: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });
      return reply.code(202).send({ status: "pending_verification" });
    }

    const passwordHash = await hashPassword(input.password);

    let created: UserRow | undefined;
    try {
      [created] = await db
        .insert(users)
        .values({
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          passwordHash,
        })
        .returning();
    } catch (error) {
      // Unique violation from a concurrent signup: answer identically.
      if (isUniqueViolation(error)) {
        return reply.code(202).send({ status: "pending_verification" });
      }
      throw error;
    }

    if (!created) throw errors.internal();

    await issueOtp({
      email: created.email,
      purpose: "verify_email",
      userId: created.id,
      firstName: created.firstName,
    });

    await recordAudit({
      action: "signup_created",
      actorUserId: created.id,
      target: created.email,
      ip: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    });

    return reply.code(202).send({ status: "pending_verification" });
  });

  app.post(
    "/verify-email",
    { config: { rateLimit: limits.verify } },
    async (request, reply) => {
      const input = parseBody(verifyEmailSchema, request.body);

      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.email, input.email), isNull(users.deletedAt)))
        .limit(1);

      if (!user) throw errors.otpInvalid();
      if (user.status === "suspended") throw errors.suspended();

      if (!user.emailVerifiedAt) {
        await consumeOtp({ email: user.email, purpose: "verify_email", code: input.code });
        const [updated] = await db
          .update(users)
          .set({ status: "active", emailVerifiedAt: new Date(), updatedAt: new Date() })
          .where(eq(users.id, user.id))
          .returning();
        if (!updated) throw errors.internal();
        await recordAudit({
          action: "email_verified",
          actorUserId: updated.id,
          target: updated.email,
          ip: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        });
        await startSession(reply, updated, request);
        return reply.code(200).send({ user: toDTO(updated) });
      }

      await startSession(reply, user, request);
      return reply.code(200).send({ user: toDTO(user) });
    },
  );

  app.post(
    "/resend-otp",
    { config: { rateLimit: limits.otp } },
    async (request, reply) => {
      const input = parseBody(resendOtpSchema, request.body);

      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.email, input.email), isNull(users.deletedAt)))
        .limit(1);

      if (user && !user.emailVerifiedAt && user.status !== "suspended") {
        await issueOtp({
          email: user.email,
          purpose: "verify_email",
          userId: user.id,
          firstName: user.firstName,
        }).catch((error: unknown) => {
          if (error instanceof AppError && error.code === "OTP_COOLDOWN") return;
          throw error;
        });
      }

      return reply.code(202).send({ status: "accepted" });
    },
  );

  app.post(
    "/login",
    { config: { rateLimit: limits.login } },
    async (request, reply) => {
      const input = parseBody(loginSchema, request.body);

      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.email, input.email), isNull(users.deletedAt)))
        .limit(1);

      if (!user) {
        await verifyAgainstDummy(input.password);
        throw errors.invalidCredentials();
      }

      const now = Date.now();
      if (user.lockedUntil && user.lockedUntil.getTime() > now) {
        throw errors.locked(Math.ceil((user.lockedUntil.getTime() - now) / 1000));
      }

      if (!(await verifyPassword(input.password, user.passwordHash))) {
        const failures = user.failedLoginCount + 1;
        if (failures >= env.LOGIN_MAX_FAILURES) {
          const lockedUntil = new Date(now + env.LOGIN_LOCK_MINUTES * 60 * 1000);
          await db
            .update(users)
            .set({ failedLoginCount: 0, lockedUntil, updatedAt: new Date() })
            .where(eq(users.id, user.id));
          await recordAudit({
            action: "login_locked",
            actorUserId: user.id,
            target: user.email,
            ip: request.ip,
            userAgent: request.headers["user-agent"] ?? null,
          });
          throw errors.locked(env.LOGIN_LOCK_MINUTES * 60);
        }
        await db
          .update(users)
          .set({ failedLoginCount: failures, updatedAt: new Date() })
          .where(eq(users.id, user.id));
        await recordAudit({
          action: "login_failed",
          actorUserId: user.id,
          target: user.email,
          ip: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
          metadata: { failures },
        });
        throw errors.invalidCredentials();
      }

      if (user.status === "unverified") throw errors.emailUnverified();
      if (user.status === "suspended") throw errors.suspended();

      const [refreshed] = await db
        .update(users)
        .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
        .where(eq(users.id, user.id))
        .returning();
      if (!refreshed) throw errors.internal();

      await startSession(reply, refreshed, request);
      await recordAudit({
        action: "login_succeeded",
        actorUserId: refreshed.id,
        target: refreshed.email,
        ip: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      return reply.code(200).send({ user: toDTO(refreshed) });
    },
  );

  app.post("/refresh", async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE];
    if (!token) throw errors.unauthenticated("Session expired. Sign in again");

    try {
      const result = await rotateRefreshToken({
        token,
        ip: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });
      const accessToken = await signAccessToken(result.user);
      setAuthCookies(reply, { accessToken, refreshToken: result.refreshToken });
      const [row] = await db.select().from(users).where(eq(users.id, result.user.id)).limit(1);
      if (!row) throw errors.unauthenticated();
      return reply.code(200).send({ user: toDTO(row) });
    } catch (error) {
      clearAuthCookies(reply);
      throw error;
    }
  });

  app.post("/logout", async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE];
    if (token) await revokeRefreshToken(token);
    clearAuthCookies(reply);
    return reply.code(204).send();
  });

  app.post("/logout-all", { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user;
    if (!user) throw errors.unauthenticated();
    await revokeAllForUser(user.id);
    await db
      .update(users)
      .set({ tokenVersion: sql`${users.tokenVersion} + 1`, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    clearAuthCookies(reply);
    await recordAudit({
      action: "logout_all",
      actorUserId: user.id,
      target: user.email,
      ip: request.ip,
    });
    return reply.code(204).send();
  });

  app.get("/me", { preHandler: requireAuth }, async (request) => {
    const current = request.user;
    if (!current) throw errors.unauthenticated();
    const [row] = await db.select().from(users).where(eq(users.id, current.id)).limit(1);
    if (!row) throw errors.unauthenticated();
    return { user: toDTO(row) };
  });
}
