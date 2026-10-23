import {
  changePasswordSchema,
  resetConfirmSchema,
  resetRequestSchema,
} from "@stt/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../db";
import { users } from "../db/schema";
import { recordAudit } from "../lib/audit";
import { requireAuth } from "../lib/auth-guard";
import { clearAuthCookies } from "../lib/cookies";
import { hashPassword, verifyPassword } from "../lib/crypto";
import { AppError, errors } from "../lib/errors";
import { parseBody } from "../lib/http";
import { limits } from "../lib/limits";
import { sendPasswordChangedMail } from "../lib/mailer";
import { consumeOtp, issueOtp } from "../lib/otp";
import { revokeAllForUser } from "../lib/tokens";

export async function passwordRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/password/change/otp",
    { preHandler: requireAuth, config: { rateLimit: limits.otp } },
    async (request, reply) => {
      const current = request.user;
      if (!current) throw errors.unauthenticated();

      const [user] = await db.select().from(users).where(eq(users.id, current.id)).limit(1);
      if (!user) throw errors.unauthenticated();

      await issueOtp({
        email: user.email,
        purpose: "password_change",
        userId: user.id,
        firstName: user.firstName,
      });
      void recordAudit({
        action: "password_change_otp_requested",
        actorUserId: user.id,
        target: user.email,
        ip: request.ip,
      });
      return reply.code(202).send({ status: "accepted" });
    },
  );

  app.post(
    "/password/change",
    { preHandler: requireAuth, config: { rateLimit: limits.verify } },
    async (request, reply) => {
      const current = request.user;
      if (!current) throw errors.unauthenticated();
      const input = parseBody(changePasswordSchema, request.body);

      const [user] = await db.select().from(users).where(eq(users.id, current.id)).limit(1);
      if (!user) throw errors.unauthenticated();

      if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
        throw errors.validation({ currentPassword: "Current password is incorrect" });
      }

      await consumeOtp({
        email: user.email,
        purpose: "password_change",
        code: input.code,
      });

      const passwordHash = await hashPassword(input.newPassword);
      await db
        .update(users)
        .set({
          passwordHash,
          tokenVersion: sql`${users.tokenVersion} + 1`,
          failedLoginCount: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));
      await revokeAllForUser(user.id);
      clearAuthCookies(reply);
      sendPasswordChangedMail(user.email, user.firstName);
      void recordAudit({
        action: "password_changed",
        actorUserId: user.id,
        target: user.email,
        ip: request.ip,
      });

      return reply.code(204).send();
    },
  );

  app.post(
    "/password/reset/request",
    { config: { rateLimit: limits.signup } },
    async (request, reply) => {
      const input = parseBody(resetRequestSchema, request.body);

      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.email, input.email), isNull(users.deletedAt)))
        .limit(1);

      if (user && user.status === "active") {
        await issueOtp({
          email: user.email,
          purpose: "password_reset",
          userId: user.id,
          firstName: user.firstName,
        }).catch((error: unknown) => {
          if (error instanceof AppError && error.code === "OTP_COOLDOWN") return;
          throw error;
        });
      }

      void recordAudit({
        action: "password_reset_requested",
        target: input.email,
        ip: request.ip,
      });
      return reply.code(202).send({ status: "accepted" });
    },
  );

  app.post(
    "/password/reset/confirm",
    { config: { rateLimit: limits.verify } },
    async (request, reply) => {
      const input = parseBody(resetConfirmSchema, request.body);

      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.email, input.email), isNull(users.deletedAt)))
        .limit(1);
      if (!user) throw errors.otpInvalid();

      await consumeOtp({
        email: user.email,
        purpose: "password_reset",
        code: input.code,
      });

      const passwordHash = await hashPassword(input.newPassword);
      await db
        .update(users)
        .set({
          passwordHash,
          tokenVersion: sql`${users.tokenVersion} + 1`,
          failedLoginCount: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));
      await revokeAllForUser(user.id);
      clearAuthCookies(reply);
      sendPasswordChangedMail(user.email, user.firstName);
      void recordAudit({
        action: "password_reset",
        actorUserId: user.id,
        target: user.email,
        ip: request.ip,
      });

      return reply.code(204).send();
    },
  );
}
