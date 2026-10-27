import { env } from "../env";

export const limits = {
  global: { max: env.RATE_LIMIT_GLOBAL_MAX, timeWindow: "1 minute" },
  signup: { max: env.RATE_LIMIT_SIGNUP_MAX, timeWindow: "10 minutes" },
  login: { max: env.RATE_LIMIT_LOGIN_MAX, timeWindow: "1 minute" },
  otp: { max: env.RATE_LIMIT_OTP_MAX, timeWindow: "10 minutes" },
  verify: { max: env.RATE_LIMIT_VERIFY_MAX, timeWindow: "10 minutes" },
  upload: { max: env.NODE_ENV === "test" ? 100_000 : 10, timeWindow: "1 hour" },
  recordStart: { max: env.NODE_ENV === "test" ? 100_000 : 20, timeWindow: "1 minute" },
} as const;
