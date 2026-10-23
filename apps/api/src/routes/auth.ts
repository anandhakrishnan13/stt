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
import { checkOtp, consumeOtp, consumeOtpRow, issueOtp } from "../lib/otp";
import {
  issueRefreshToken,
  revokeAllForUser,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
} from "../lib/tokens";

type PublicUser = Pick<
  UserRow,
  "id" | "email" | "firstName" | "lastName" | "emailVerifiedAt" | "createdAt"
>;

function toDTO(user: PublicUser): UserDTO {
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

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/signup", { config: { rateLimit: limits.signup } }, async (request, reply) => {
    const input = parseBody(signupSchema, request.body);

    // Hash before touching the database so an existing address costs the same
    // as a new one (no account-enumeration timing signal).
    const passwordHash = await hashPassword(input.password);

    // One hop for the common case, and it also settles the concurrent-signup
    // race the old lookup-then-insert needed a unique-violation catch for.
    const [created] = await db
      .insert(users)
      .values({
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        passwordHash,
      })
      .onConflictDoNothing({ target: users.email })
      .returning();

    if (!created) {
      const [existing] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);

      // Never reveal whether the address exists.
      if (existing?.deletedAt === null && existing?.status === "unverified") {
        await issueOtp({
          email: existing.email,
          purpose: "verify_email",
          userId: existing.id,
          firstName: existing.firstName,
        }).catch((error: unknown) => {
          if (error instanceof AppError && error.code === "OTP_COOLDOWN") return;
          throw error;
        });
      } else if (existing?.deletedAt === null && existing?.emailVerifiedAt) {
        sendAccountExistsMail(existing.email, existing.firstName);
      }
      // Audit is best-effort and must not delay the response.
      void recordAudit({
        action: "signup_existing_email",
        target: input.email,
        ip: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });
      return reply.code(202).send({ status: "pending_verification" });
    }

    await issueOtp({
      email: created.email,
      purpose: "verify_email",
      userId: created.id,
      firstName: created.firstName,
    });

    void recordAudit({
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
        // Validate first (a bad code must not open a session), then spend one
        // round trip on the three independent writes.
        const otpId = await checkOtp({
          email: user.email,
          purpose: "verify_email",
          code: input.code,
        });
        const verifiedAt = new Date();
        const verified = { ...user, status: "active" as const, emailVerifiedAt: verifiedAt };

        await Promise.all([
          consumeOtpRow(otpId),
          db
            .update(users)
            .set({ status: "active", emailVerifiedAt: verifiedAt, updatedAt: verifiedAt })
            .where(eq(users.id, user.id)),
          startSession(reply, user, request),
        ]);

        void recordAudit({
          action: "email_verified",
          actorUserId: user.id,
          target: user.email,
          ip: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        });
        return reply.code(200).send({ user: toDTO(verified) });
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
          void recordAudit({
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
        void recordAudit({
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

      // Only pay for the reset write when there is something to reset; run
      // the write in parallel with session issuance so it does not add an RTT.
      const resetNeeded = user.failedLoginCount > 0 || user.lockedUntil !== null;
      let refreshed: PublicUser = user;

      if (resetNeeded) {
        const [updatedRows] = await Promise.all([
          db
            .update(users)
            .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
            .where(eq(users.id, user.id))
            .returning(),
          startSession(reply, user, request),
        ]);
        if (!updatedRows[0]) throw errors.internal();
        refreshed = updatedRows[0];
      } else {
        await startSession(reply, user, request);
      }
      void recordAudit({
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
      return reply.code(200).send({ user: toDTO(result.user) });
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
    return { user: toDTO(current) };
  });
}
