import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app";
import { resetDb } from "./db";
import { users } from "../src/db/schema";
import { clearOutbox, getOutbox } from "../src/lib/mailer";
import { eq } from "drizzle-orm";
import { db } from "../src/db";

const PASSWORD = "CorrectHorse42";
const NEW_PASSWORD = "DifferentHorse77";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDb();
  clearOutbox();
});

function setCookieHeaders(res: LightMyRequestResponse): string[] {
  const raw = res.headers["set-cookie"];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function cookieHeader(res: LightMyRequestResponse): string {
  return setCookieHeaders(res)
    .map((cookie) => cookie.split(";")[0] ?? "")
    .filter(Boolean)
    .join("; ");
}

function cookieValue(res: LightMyRequestResponse, name: string): string {
  for (const cookie of setCookieHeaders(res)) {
    const [pair] = cookie.split(";");
    if (pair?.startsWith(`${name}=`)) return pair.slice(name.length + 1);
  }
  throw new Error(`cookie ${name} missing`);
}

function lastOtpCode(): string {
  const mail = getOutbox().at(-1);
  if (!mail) throw new Error("no mail was sent");
  const match = mail.text.match(/\b(\d{6})\b/);
  if (!match?.[1]) throw new Error(`no code in mail: ${mail.text}`);
  return match[1];
}

async function signup(email: string): Promise<void> {
  const res = await app.inject({
    method: "POST",
    url: "/auth/signup",
    payload: { firstName: "Asha", lastName: "Rao", email, password: PASSWORD },
  });
  expect(res.statusCode).toBe(202);
}

async function signupAndVerify(email: string): Promise<string> {
  await signup(email);
  const res = await app.inject({
    method: "POST",
    url: "/auth/verify-email",
    payload: { email, code: lastOtpCode() },
  });
  expect(res.statusCode).toBe(200);
  return cookieHeader(res);
}

async function login(email: string, password = PASSWORD): Promise<LightMyRequestResponse> {
  return app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  });
}

describe("signup and email verification", () => {
  test("verifies the emailed code and opens a session", async () => {
    const email = "asha@example.com";
    await signup(email);

    const mail = getOutbox().at(-1);
    expect(mail?.to).toBe(email);
    expect(mail?.subject).toContain("Verify");

    const res = await app.inject({
      method: "POST",
      url: "/auth/verify-email",
      payload: { email, code: lastOtpCode() },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe(email);
    expect(res.json().user.emailVerifiedAt).toBeTruthy();
    expect(setCookieHeaders(res).length).toBeGreaterThanOrEqual(3);

    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { cookie: cookieHeader(res) },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe(email);
  });

  test("caps wrong guesses and invalidates the code", async () => {
    const email = "brute@example.com";
    await signup(email);
    const code = lastOtpCode();
    const wrong = code === "000000" ? "000001" : "000000";

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const res = await app.inject({
        method: "POST",
        url: "/auth/verify-email",
        payload: { email, code: wrong },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("OTP_INVALID");
    }

    const fifth = await app.inject({
      method: "POST",
      url: "/auth/verify-email",
      payload: { email, code: wrong },
    });
    expect(fifth.json().error.code).toBe("OTP_ATTEMPTS_EXCEEDED");

    const correctAfter = await app.inject({
      method: "POST",
      url: "/auth/verify-email",
      payload: { email, code },
    });
    expect(correctAfter.statusCode).toBe(400);
    expect(correctAfter.json().error.code).toBe("OTP_ATTEMPTS_EXCEEDED");
  });

  test("answers concurrent signups identically without surfacing a 500", async () => {
    const email = "race@example.com";

    // Both requests pass the existence pre-check before either insert lands,
    // so the loser hits PostgreSQL's unique_violation and must still see 202.
    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: { email, password: PASSWORD, firstName: "Asha", lastName: "Rao" },
      }),
      app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: { email, password: PASSWORD, firstName: "Asha", lastName: "Rao" },
      }),
    ]);

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(first.json()).toEqual({ status: "pending_verification" });
    expect(second.json()).toEqual({ status: "pending_verification" });

    const rows = await db.select().from(users).where(eq(users.email, email));
    expect(rows.length).toBe(1);
  });

  test("does not reveal that an email already exists", async () => {
    const email = "dup@example.com";
    await signup(email);
    await signupAndVerify(email);

    await signup(email);

    const rows = await db.select().from(users).where(eq(users.email, email));
    expect(rows.length).toBe(1);
    expect(getOutbox().at(-1)?.text).toContain("already exists");
  });

  test("blocks login until the email is verified", async () => {
    const email = "unverified@example.com";
    await signup(email);

    const res = await login(email);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("EMAIL_UNVERIFIED");
  });
});

describe("login and sessions", () => {
  test("rejects a bad password and locks after repeated failures", async () => {
    const email = "lock@example.com";
    await signupAndVerify(email);

    const first = await login(email, "WrongPassword1");
    expect(first.statusCode).toBe(401);
    expect(first.json().error.code).toBe("INVALID_CREDENTIALS");

    const second = await login(email, "WrongPassword1");
    expect(second.statusCode).toBe(401);

    const third = await login(email, "WrongPassword1");
    expect(third.statusCode).toBe(423);
    expect(third.json().error.code).toBe("ACCOUNT_LOCKED");

    const correctWhileLocked = await login(email);
    expect(correctWhileLocked.statusCode).toBe(423);
  });

  test("rotates refresh tokens and revokes the family on replay", async () => {
    const email = "rotate@example.com";
    await signupAndVerify(email);

    const session = await login(email);
    expect(session.statusCode).toBe(200);
    const firstRefresh = cookieValue(session, "st_refresh");

    const rotated = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: { cookie: `st_refresh=${firstRefresh}` },
    });
    expect(rotated.statusCode).toBe(200);
    const secondRefresh = cookieValue(rotated, "st_refresh");
    expect(secondRefresh).not.toBe(firstRefresh);

    const replay = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: { cookie: `st_refresh=${firstRefresh}` },
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.message).toContain("reuse");

    const familyAfterReplay = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: { cookie: `st_refresh=${secondRefresh}` },
    });
    expect(familyAfterReplay.statusCode).toBe(401);
  });

  test("rejects tokens belonging to a soft-deleted user", async () => {
    const email = "deleted@example.com";
    const cookies = await signupAndVerify(email);

    const before = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { cookie: cookies },
    });
    expect(before.statusCode).toBe(200);

    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.email, email));

    const after = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { cookie: cookies },
    });
    expect(after.statusCode).toBe(401);
  });

  test("logout-all revokes every session", async () => {
    const email = "logout@example.com";
    const cookies = await signupAndVerify(email);

    const res = await app.inject({
      method: "POST",
      url: "/auth/logout-all",
      headers: { cookie: cookies },
    });
    expect(res.statusCode).toBe(204);

    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { cookie: cookies },
    });
    expect(me.statusCode).toBe(401);
  });

  test("requires a session for /auth/me", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHENTICATED");
  });
});

describe("password change and reset", () => {
  test("change requires the current password and the emailed code, then kills old sessions", async () => {
    const email = "change@example.com";
    const cookies = await signupAndVerify(email);
    const accessBefore = cookieValue(
      await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: PASSWORD } }),
      "st_access",
    );

    const otpRequest = await app.inject({
      method: "POST",
      url: "/auth/password/change/otp",
      headers: { cookie: `st_access=${accessBefore}` },
    });
    expect(otpRequest.statusCode).toBe(202);
    const code = lastOtpCode();

    const wrongCurrent = await app.inject({
      method: "POST",
      url: "/auth/password/change",
      headers: { cookie: `st_access=${accessBefore}` },
      payload: { currentPassword: "WrongPassword1", code, newPassword: NEW_PASSWORD },
    });
    expect(wrongCurrent.statusCode).toBe(400);
    expect(wrongCurrent.json().error.details.currentPassword).toBeTruthy();

    const changed = await app.inject({
      method: "POST",
      url: "/auth/password/change",
      headers: { cookie: `st_access=${accessBefore}` },
      payload: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    });
    expect(changed.statusCode).toBe(200);

    const newAccess = cookieValue(changed, "st_access");
    expect(newAccess).toBeTruthy();
    const authedWithNew = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { cookie: `st_access=${newAccess}` },
    });
    expect(authedWithNew.statusCode).toBe(200);
    const staleAccess = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { cookie: `st_access=${accessBefore}` },
    });
    expect(staleAccess.statusCode).toBe(401);

    const oldPassword = await login(email, PASSWORD);
    expect(oldPassword.statusCode).toBe(401);

    const newPassword = await login(email, NEW_PASSWORD);
    expect(newPassword.statusCode).toBe(200);

    // Change password again with forgot-password mode (no currentPassword, valid OTP)
    const otpRequest2 = await app.inject({
      method: "POST",
      url: "/auth/password/change/otp",
      headers: { cookie: `st_access=${newAccess}` },
    });
    expect(otpRequest2.statusCode).toBe(202);
    const code2 = lastOtpCode();

    const changedWithoutCurrent = await app.inject({
      method: "POST",
      url: "/auth/password/change",
      headers: { cookie: `st_access=${newAccess}` },
      payload: { code: code2, newPassword: "EvenNewerPassword123" },
    });
    expect(changedWithoutCurrent.statusCode).toBe(200);
    expect(cookies.length).toBeGreaterThan(0);
  });

  test("reset flow works without a session", async () => {
    const email = "reset@example.com";
    await signupAndVerify(email);

    const request = await app.inject({
      method: "POST",
      url: "/auth/password/reset/request",
      payload: { email },
    });
    expect(request.statusCode).toBe(202);
    const code = lastOtpCode();

    const confirm = await app.inject({
      method: "POST",
      url: "/auth/password/reset/confirm",
      payload: { email, code, newPassword: NEW_PASSWORD },
    });
    expect(confirm.statusCode).toBe(204);

    expect((await login(email, PASSWORD)).statusCode).toBe(401);
    expect((await login(email, NEW_PASSWORD)).statusCode).toBe(200);
  });

  test("reset request for an unknown address answers identically and sends nothing", async () => {
    const request = await app.inject({
      method: "POST",
      url: "/auth/password/reset/request",
      payload: { email: "nobody@example.com" },
    });
    expect(request.statusCode).toBe(202);
    expect(getOutbox().length).toBe(0);
  });
});
