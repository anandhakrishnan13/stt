import type { FastifyRequest } from "fastify";
import { ACCESS_COOKIE } from "./cookies";
import { errors } from "./errors";
import { findLiveUser, verifyAccessToken } from "./tokens";

export type AuthUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
};

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/**
 * Signature check is not enough: the user row must still exist, be active and
 * not soft-deleted, and its token version must match the token claim.
 */
export async function requireAuth(request: FastifyRequest): Promise<void> {
  const token = request.cookies[ACCESS_COOKIE];
  if (!token) throw errors.unauthenticated();

  const claims = await verifyAccessToken(token);
  if (!claims) throw errors.unauthenticated("Session expired. Sign in again");

  const user = await findLiveUser(claims.userId);
  if (!user || user.tokenVersion !== claims.tokenVersion) {
    throw errors.unauthenticated("Session is no longer valid. Sign in again");
  }

  // The row is already loaded here; handlers that only need public fields
  // must not pay a second round trip for it.
  request.user = {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt,
  };
}
