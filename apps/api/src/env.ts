import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1).default("file:./local.db"),
  PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),

  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  OTP_PEPPER: z.string().min(32, "OTP_PEPPER must be at least 32 characters"),

  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().nonnegative().default(60),
  OTP_HOURLY_LIMIT: z.coerce.number().int().positive().default(5),

  RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().positive().default(200),
  RATE_LIMIT_SIGNUP_MAX: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_OTP_MAX: z.coerce.number().int().positive().default(3),
  RATE_LIMIT_VERIFY_MAX: z.coerce.number().int().positive().default(20),

  LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),

  STORAGE_DRIVER: z.enum(["local", "supabase"]).default("local"),
  STORAGE_DIR: z.string().default("./storage"),
  SUPABASE_URL: z.string().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(""),
  SUPABASE_BUCKET: z.string().default("transcripts"),
  MAX_AUDIO_BYTES: z.coerce.number().int().positive().default(64 * 1024 * 1024),

  WHISPER_URL: z.string().default("http://127.0.0.1:8081"),
  WHISPER_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  STT_STEP_MS: z.coerce.number().int().min(500).default(2_000),
  STT_MAX_WINDOW_MS: z.coerce.number().int().min(2_000).default(12_000),
  STT_MIN_WINDOW_MS: z.coerce.number().int().min(200).default(800),
  STT_SILENCE_RMS: z.coerce.number().int().nonnegative().default(220),

  SMTP_URL: z.string().default(""),
  SMTP_FROM: z.string().default("Speech to Text <no-reply@stt.local>"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment:\n${details}`);
}

if (parsed.data.STORAGE_DRIVER === "supabase") {
  if (!parsed.data.SUPABASE_URL || !parsed.data.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Invalid environment:\nSUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when STORAGE_DRIVER=supabase",
    );
  }
}

export const env = parsed.data;

export const corsOrigins = env.CORS_ORIGINS.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
