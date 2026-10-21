/**
 * Loaded via `bun test --preload ./test/setup.ts`, before any app module reads
 * process.env. Provisions a disposable PostgreSQL database per test process and
 * applies migrations.
 */
import { afterAll } from "bun:test";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import postgres from "postgres";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-0123456789abcdef0123456789";
process.env.OTP_PEPPER = "test-otp-pepper-0123456789abcdef0123456789";
process.env.SMTP_URL = "";
process.env.PUBLIC_APP_URL = "http://localhost:3000";
process.env.CORS_ORIGINS = "http://localhost:3000";
process.env.OTP_RESEND_COOLDOWN_SECONDS = "0";
process.env.OTP_HOURLY_LIMIT = "100";
process.env.LOGIN_MAX_FAILURES = "3";
process.env.LOGIN_LOCK_MINUTES = "15";
process.env.RATE_LIMIT_GLOBAL_MAX = "100000";
process.env.RATE_LIMIT_SIGNUP_MAX = "100000";
process.env.RATE_LIMIT_LOGIN_MAX = "100000";
process.env.RATE_LIMIT_OTP_MAX = "100000";
process.env.RATE_LIMIT_VERIFY_MAX = "100000";

process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_DIR = `/tmp/stt-test-storage-${process.pid}`;

process.env.STT_PROVIDER = "groq";
process.env.GROQ_API_KEY = "test-groq-key";
process.env.STT_STEP_MS = "2000";
process.env.STT_MAX_WINDOW_MS = "2000";
process.env.STT_MIN_WINDOW_MS = "500";

rmSync(process.env.STORAGE_DIR, { recursive: true, force: true });

const adminUrl =
  process.env.TEST_DATABASE_URL ?? "postgresql://stt:stt@127.0.0.1:5432/postgres";
const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
const database = `stt_test_${process.pid}_${randomUUID().slice(0, 8)}`;

try {
  await admin.unsafe(`CREATE DATABASE "${database}"`);
} catch (error) {
  console.error("Start PostgreSQL with: bun run services:up");
  await admin.end({ timeout: 5 });
  throw error;
}

const url = new URL(adminUrl);
url.pathname = `/${database}`;
process.env.DATABASE_URL = url.toString();
process.env.DATABASE_SSL = "false";

// Static imports are hoisted above the env assignments above, so modules that
// read process.env must be imported dynamically afterwards (this file is a
// bun test preload whose whole purpose is ordering env setup before app code).
const { runMigrations } = await import("../src/db/migrate");
await runMigrations();

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  await admin.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  await admin.end({ timeout: 5 });
});
