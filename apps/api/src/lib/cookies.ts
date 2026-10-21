import type { FastifyReply } from "fastify";
import { env } from "../env";

export const ACCESS_COOKIE = "st_access";
export const REFRESH_COOKIE = "st_refresh";
export const SESSION_COOKIE = "st_session";

const secure = env.NODE_ENV === "production";

export function setAuthCookies(
  reply: FastifyReply,
  tokens: { accessToken: string; refreshToken: string },
): void {
  reply.setCookie(ACCESS_COOKIE, tokens.accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: env.ACCESS_TOKEN_TTL_SECONDS,
  });
  reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/auth",
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
  });
  reply.setCookie(SESSION_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
  });
}

export function clearAuthCookies(reply: FastifyReply): void {
  const common = { httpOnly: true, sameSite: "lax", secure } as const;
  reply.clearCookie(ACCESS_COOKIE, { ...common, path: "/" });
  reply.clearCookie(REFRESH_COOKIE, { ...common, path: "/auth" });
  reply.clearCookie(SESSION_COOKIE, { ...common, path: "/" });
}
