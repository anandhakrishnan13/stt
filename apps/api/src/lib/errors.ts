import type { ErrorCodeValue } from "@stt/shared";
import { ErrorCode } from "@stt/shared";

export class AppError extends Error {
  constructor(
    readonly code: ErrorCodeValue,
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const errors = {
  validation: (details: unknown) =>
    new AppError(ErrorCode.VALIDATION_ERROR, 400, "Check the highlighted fields", details),
  unauthenticated: (message = "Sign in to continue") =>
    new AppError(ErrorCode.UNAUTHENTICATED, 401, message),
  invalidCredentials: () =>
    new AppError(ErrorCode.INVALID_CREDENTIALS, 401, "Invalid email or password"),
  emailUnverified: () =>
    new AppError(
      ErrorCode.EMAIL_UNVERIFIED,
      403,
      "Verify your email address before signing in",
    ),
  suspended: () => new AppError(ErrorCode.ACCOUNT_SUSPENDED, 403, "This account is suspended"),
  locked: (retryAfterSeconds: number) =>
    new AppError(ErrorCode.ACCOUNT_LOCKED, 423, "Too many failed attempts. Try again later", {
      retryAfterSeconds,
    }),
  otpInvalid: () => new AppError(ErrorCode.OTP_INVALID, 400, "That code is not valid"),
  otpExpired: () =>
    new AppError(ErrorCode.OTP_EXPIRED, 400, "That code has expired. Request a new one"),
  otpAttemptsExceeded: () =>
    new AppError(
      ErrorCode.OTP_ATTEMPTS_EXCEEDED,
      400,
      "Too many incorrect codes. Request a new one",
    ),
  otpCooldown: (retryAfterSeconds: number) =>
    new AppError(ErrorCode.OTP_COOLDOWN, 429, "A code was just sent. Wait before requesting another", {
      retryAfterSeconds,
    }),
  csrf: () => new AppError(ErrorCode.CSRF_ORIGIN, 403, "Request origin is not allowed"),
  notFound: (message = "Not found") => new AppError(ErrorCode.NOT_FOUND, 404, message),
  internal: () => new AppError(ErrorCode.INTERNAL, 500, "Something went wrong"),
};
