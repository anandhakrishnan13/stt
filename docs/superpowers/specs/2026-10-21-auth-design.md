# Auth slice — design

Date: 2026-10-21
Status: approved, implemented in this slice

## Goal

Email/password accounts for the Speech-to-Text app: signup with email OTP verification, login,
rotating refresh sessions, password change and password reset — each password-changing flow gated
by an emailed OTP. No roles; every authenticated user may only touch their own resources.

Out of scope for this slice: transcription, audio streaming, dashboard data, OAuth, MFA devices.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Runtime / package manager | Bun 1.4 (workspaces, runtime, test runner) | One toolchain; `Bun.password` gives argon2id without native builds |
| HTTP framework | Fastify 5 + TypeScript | Plugin set maps 1:1 to cookie/rate-limit/helmet/CORS needs; keeps the audio gateway in the same process for the next slice |
| Database | SQLite via `bun:sqlite` + Drizzle ORM (Postgres later) | Zero infrastructure to start; Drizzle keeps the schema typed and the Postgres swap mechanical |
| Session transport | httpOnly cookies (`SameSite=Lax`) | Bearer-in-localStorage exposes tokens to XSS |
| Hashing | argon2id via `Bun.password` (m=19456 KiB, t=2) | Memory-hard, current recommendation |
| OTP storage | HMAC-SHA256(code, `OTP_PEPPER`), never plaintext | 6-digit space is brute-forceable if a DB dump leaks unsalted hashes |

## Data model

- `users` — id, email (unique, stored lowercased), first_name, last_name, password_hash,
  status (`unverified|active|suspended`), email_verified_at, token_version, failed_login_count,
  locked_until, created_at, updated_at, deleted_at.
- `refresh_tokens` — id, user_id, token_hash (sha256), family_id, expires_at, revoked_at,
  replaced_by, user_agent, ip, created_at.
- `email_otps` — id, email, user_id?, purpose (`verify_email|password_change|password_reset`),
  code_hmac, attempts, expires_at, sent_at, consumed_at.
- `audit_events` — actor_user_id?, action, target?, ip, user_agent, metadata jsonb, created_at.

Soft delete, not row deletion: audit trails and stale-token checks need the row to exist.

## Sessions

- Access token: JWT HS256, 15 min, claims `{ sub, ver, jti, typ: "access" }`, cookie `st_access`
  (httpOnly, SameSite=Lax, path=/, Secure in production).
- Refresh token: 256-bit random, sha256 at rest, 30 days, cookie `st_refresh`
  (httpOnly, path=/auth). Rotated on every refresh; replaying a rotated token revokes the whole
  `family_id` and writes an audit event.
- `st_session=1` marker cookie (httpOnly, path=/) so the Next middleware can do UX redirects
  without reading the access token. It is not an authorization decision.
- `requireAuth` verifies the JWT **and then loads the user row**, rejecting when the user is
  missing, soft-deleted, not `active`, or `token_version !== ver`. Deleting a user or changing a
  password therefore kills every live access token immediately.
- Any password change/reset increments `token_version` and revokes all refresh tokens, then clears
  the caller's cookies.

## OTP rules

6 digits from `crypto.randomInt`, 10-minute TTL, single use, 5 verification attempts, 60-second
resend cooldown, 5 sends per email+purpose per hour. Issuing a new code invalidates previous
unconsumed codes for that email+purpose. Every check is constant-time over hex HMACs.

## Endpoints

```
POST /auth/signup              {firstName,lastName,email,password} -> 202
POST /auth/verify-email        {email,code} -> 200 + cookies
POST /auth/resend-otp          {email} -> 202
POST /auth/login               {email,password} -> 200 + cookies
POST /auth/refresh             (cookie) -> 200 + rotated cookies
POST /auth/logout              (cookie) -> 204
POST /auth/logout-all          (auth) -> 204
GET  /auth/me                  (auth) -> user
POST /auth/password/change/otp (auth) -> 202
POST /auth/password/change     {currentPassword,code,newPassword} (auth) -> 204
POST /auth/password/reset/request {email} -> 202
POST /auth/password/reset/confirm {email,code,newPassword} -> 204
```

Errors are `{ error: { code, message, details? } }`. Codes: `VALIDATION_ERROR`, `INVALID_CREDENTIALS`,
`EMAIL_UNVERIFIED`, `ACCOUNT_SUSPENDED`, `ACCOUNT_LOCKED`, `OTP_INVALID`, `OTP_EXPIRED`,
`OTP_ATTEMPTS_EXCEEDED`, `OTP_COOLDOWN`, `UNAUTHENTICATED`, `CSRF_ORIGIN`, `RATE_LIMITED`, `INTERNAL`.

## Abuse resistance

Global rate limit 200/min/IP; per-route limits on signup, login, OTP send/verify. Five failed logins
locks the account for 15 minutes. Signup, resend, and reset-request always return 202 regardless of
whether the address exists (enumeration resistance); an existing verified address receives an
"account already exists" mail instead of an OTP. Login only distinguishes unverified/locked states
after a correct password.

## Frontend

Next.js 15 App Router, Tailwind v4, shadcn-style components, react-hook-form + zod (shared schemas).
Client fetch wrapper retries once through `/auth/refresh` on 401, then redirects to /login.
Pages: `/signup`, `/verify-email`, `/login`, `/forgot-password`, `/reset-password`, `/dashboard`,
`/account` with a password-change dialog.

## Testing

`bun test` against a disposable SQLite file: signup→verify→login, attempt cap, resend
cooldown, unverified login block, refresh rotation + replay detection, stale token after soft
delete, password change revoking old sessions, reset flow, duplicate signup non-enumeration.
Manual browser pass against Mailpit for the same flow.
