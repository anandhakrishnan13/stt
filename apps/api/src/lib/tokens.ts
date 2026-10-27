import { ErrorCode } from "@stt/shared";
import { and, eq, isNull } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import { db } from "../db";
import { refreshTokens, users, type UserRow } from "../db/schema";
import { env } from "../env";
import { randomUUID } from "node:crypto";
import { randomToken, sha256Hex } from "./crypto";
import { AppError, errors } from "./errors";

const secret = new TextEncoder().encode(env.JWT_SECRET);

export async function signAccessToken(user: Pick<UserRow, "id" | "tokenVersion">): Promise<string> {
  return new SignJWT({ ver: user.tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

export async function verifyAccessToken(
  token: string,
): Promise<{ userId: string; tokenVersion: number } | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.ver !== "number") return null;
    return { userId: payload.sub, tokenVersion: payload.ver };
  } catch {
    return null;
  }
}

function refreshExpiry(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export async function issueRefreshToken(input: {
  userId: string;
  familyId?: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<string> {
  const token = randomToken();
  await db.insert(refreshTokens).values({
    userId: input.userId,
    tokenHash: sha256Hex(token),
    familyId: input.familyId ?? randomUUID(),
    expiresAt: refreshExpiry(),
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  });
  return token;
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.tokenHash, sha256Hex(token)), isNull(refreshTokens.revokedAt)));
}

export async function revokeFamily(familyId: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
}

export async function revokeAllForUser(userId: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}

export async function findLiveUser(userId: string): Promise<UserRow | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt), eq(users.status, "active")))
    .limit(1);
  return row ?? null;
}

/**
 * Rotates a refresh token. A revoked token that is presented again means the
 * cookie leaked, so the whole family is invalidated.
 */
export async function rotateRefreshToken(input: {
  token: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ user: UserRow; refreshToken: string }> {
  const hash = sha256Hex(input.token);
  // Token and owner in one hop; a deleted/suspended owner still comes back
  // (left join) so the family can be revoked exactly as before.
  const [row] = await db
    .select({ token: refreshTokens, user: users })
    .from(refreshTokens)
    .leftJoin(users, eq(users.id, refreshTokens.userId))
    .where(eq(refreshTokens.tokenHash, hash))
    .limit(1);

  if (!row) throw errors.unauthenticated("Session expired. Sign in again");

  const { token: stored, user } = row;

  if (stored.revokedAt) {
    await revokeFamily(stored.familyId);
    throw new AppError(
      ErrorCode.UNAUTHENTICATED,
      401,
      "Session reuse detected. Sign in again",
    );
  }

  if (stored.expiresAt.getTime() <= Date.now()) {
    await revokeRefreshToken(input.token);
    throw errors.unauthenticated("Session expired. Sign in again");
  }

  if (!user || user.deletedAt || user.status !== "active") {
    await revokeFamily(stored.familyId);
    throw errors.unauthenticated("Session expired. Sign in again");
  }

  const nextToken = randomToken();
  const nextId = randomUUID();

  const [rotated] = await db
    .update(refreshTokens)
    .set({ revokedAt: new Date(), replacedBy: nextId })
    .where(and(eq(refreshTokens.id, stored.id), isNull(refreshTokens.revokedAt)))
    .returning();

  if (!rotated) {
    await revokeFamily(stored.familyId);
    throw new AppError(
      ErrorCode.UNAUTHENTICATED,
      401,
      "Session reuse detected. Sign in again",
    );
  }

  await db.insert(refreshTokens).values({
    id: nextId,
    userId: user.id,
    tokenHash: sha256Hex(nextToken),
    familyId: stored.familyId,
    expiresAt: refreshExpiry(),
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  });

  return { user, refreshToken: nextToken };
}
