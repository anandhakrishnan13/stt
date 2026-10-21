/**
 * Loaded via `bun test --preload ./test/setup.ts`, before any app module reads
 * process.env. Provisions the disposable SQLite file and applies migrations.
 */
import { rmSync } from "node:fs";

const TEST_DB_FILE = `/tmp/stt-test-${process.pid}.db`;

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = `file:${TEST_DB_FILE}`;
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

rmSync(TEST_DB_FILE, { force: true });
rmSync(process.env.STORAGE_DIR, { recursive: true, force: true });

// Static imports are hoisted above the env assignments above, so modules that
// read process.env must be imported dynamically afterwards.
const { runMigrations } = await import("../src/db/migrate");
runMigrations();
