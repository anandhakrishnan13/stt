import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  APP_NAME: z.string().min(1).default("Speech to Text"),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (value) => value.startsWith("postgres://") || value.startsWith("postgresql://"),
      "DATABASE_URL must be a PostgreSQL connection string",
    )
    .default("postgresql://stt:stt@127.0.0.1:5432/stt"),
  DATABASE_SSL: z
    .string()
    .default("false")
    .transform((value) => value === "true"),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(5),
  DATABASE_CONNECT_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(10),
  DATABASE_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(20),
  DATABASE_MAX_LIFETIME_SECONDS: z.coerce.number().int().positive().default(600),
  PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),

  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  OTP_PEPPER: z.string().min(32, "OTP_PEPPER must be at least 32 characters"),

  ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(16).default(1),
  ARGON2_ITERATIONS: z.coerce.number().int().min(1).max(10).default(2),
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(8 * 1024).max(256 * 1024).default(19_456),
  ARGON2_HASH_LENGTH: z.coerce.number().int().min(16).max(64).default(32),

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

  /** Rotate the live socket before the serverless function duration cap. */
  WS_SESSION_MAX_MS: z.coerce.number().int().min(1_000).default(240_000),

  STORAGE_DRIVER: z.enum(["local", "supabase"]).default("local"),
  STORAGE_DIR: z.string().default("./storage"),
  SUPABASE_URL: z.string().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(""),
  SUPABASE_BUCKET: z.string().default("transcripts"),
  MAX_AUDIO_BYTES: z.coerce.number().int().positive().default(15 * 1024 * 1024),

  STT_PROVIDER: z.enum(["groq", "whisper"]).default("groq"),
  STT_LANGUAGE: z.string().default(""),
  STT_PROMPT: z
    .string()
    .default(
      "Transcribe Hindi and English speech, including code-mixed Hinglish. Keep the spoken language and script.",
    ),
  GROQ_API_KEY: z.string().default(""),
  GROQ_BASE_URL: z.string().default("https://api.groq.com/openai/v1"),
  STT_GROQ_MODEL: z.string().default("whisper-large-v3-turbo"),
  GROQ_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),

  WHISPER_URL: z.string().default("http://127.0.0.1:8081"),
  WHISPER_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  STT_STEP_MS: z.coerce.number().int().min(500).default(2_000),
  STT_MAX_WINDOW_MS: z.coerce.number().int().min(1_000).default(4_000),
  STT_MIN_WINDOW_MS: z.coerce.number().int().min(200).default(1_000),
  STT_SILENCE_RMS: z.coerce.number().int().nonnegative().default(60),
  STT_MAX_BUFFER_MS: z.coerce.number().int().min(2_000).default(60_000),
  STT_CONTEXT_CHARS: z.coerce.number().int().min(0).max(2_000).default(200),
  STT_ERROR_COOLDOWN_MS: z.coerce.number().int().nonnegative().default(5_000),
  STT_MAX_FINAL_COOLDOWN_WAIT_MS: z.coerce.number().int().positive().default(10_000),

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

if (parsed.data.STT_PROVIDER === "groq" && !parsed.data.GROQ_API_KEY) {
  throw new Error(
    "Invalid environment:\nGROQ_API_KEY is required when STT_PROVIDER=groq",
  );
}

export const env = parsed.data;

export function corsOrigins(): string[] {
  const configured = env.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const vercelHosts = [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ].filter((host): host is string => Boolean(host));

  return [
    ...new Set([
      ...configured,
      ...vercelHosts.map((host) =>
        host.startsWith("http://") || host.startsWith("https://") ? host : `https://${host}`,
      ),
    ]),
  ];
}
