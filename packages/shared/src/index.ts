import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Error contract                                                      */
/* ------------------------------------------------------------------ */

export const ErrorCode = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  EMAIL_UNVERIFIED: "EMAIL_UNVERIFIED",
  ACCOUNT_SUSPENDED: "ACCOUNT_SUSPENDED",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  OTP_INVALID: "OTP_INVALID",
  OTP_EXPIRED: "OTP_EXPIRED",
  OTP_ATTEMPTS_EXCEEDED: "OTP_ATTEMPTS_EXCEEDED",
  OTP_COOLDOWN: "OTP_COOLDOWN",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  CSRF_ORIGIN: "CSRF_ORIGIN",
  NOT_FOUND: "NOT_FOUND",
  STATE_CONFLICT: "STATE_CONFLICT",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  UNSUPPORTED_MEDIA_TYPE: "UNSUPPORTED_MEDIA_TYPE",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export type ApiErrorBody = {
  error: {
    code: ErrorCodeValue;
    message: string;
    details?: unknown;
  };
};

/* ------------------------------------------------------------------ */
/* Field schemas                                                       */
/* ------------------------------------------------------------------ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_RE = /^[\p{L}\p{M}' .-]+$/u;

const COMMON_PASSWORDS: Record<string, true> = {
  password: true,
  password1: true,
  password12: true,
  password123: true,
  password1234: true,
  qwertyuiop: true,
  "1234567890": true,
  letmein123: true,
  admin12345: true,
  welcome123: true,
  iloveyou1: true,
};

export const emailSchema = z
  .string({ error: "Email is required" })
  .trim()
  .toLowerCase()
  .max(254, "Email is too long")
  .regex(EMAIL_RE, "Enter a valid email address");

export const firstNameSchema = z
  .string({ error: "First name is required" })
  .trim()
  .min(1, "First name is required")
  .max(60, "First name is too long")
  .regex(NAME_RE, "First name contains invalid characters");

export const lastNameSchema = z
  .string({ error: "Last name is required" })
  .trim()
  .min(1, "Last name is required")
  .max(60, "Last name is too long")
  .regex(NAME_RE, "Last name contains invalid characters");

export const passwordSchema = z
  .string({ error: "Password is required" })
  .min(6, "Use at least 6 characters")
  .max(128, "Use at most 128 characters")
  .refine((value) => /\p{L}/u.test(value), "Include at least one letter")
  .refine((value) => /\d/.test(value), "Include at least one number")
  .refine(
    (value) => COMMON_PASSWORDS[value.toLowerCase()] !== true,
    "This password is too common",
  );

export const otpCodeSchema = z
  .string({ error: "Verification code is required" })
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code");

export const signupSchema = z.object({
  firstName: firstNameSchema,
  lastName: lastNameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ error: "Password is required" }).min(1, "Password is required").max(128),
});

export const verifyEmailSchema = z.object({
  email: emailSchema,
  code: otpCodeSchema,
});

export const resendOtpSchema = z.object({
  email: emailSchema,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().max(128).optional(),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "Enter the 6-digit code")
      .optional(),
    newPassword: passwordSchema,
  })
  .refine(
    (data) => Boolean(data.currentPassword) || Boolean(data.code),
    {
      path: ["currentPassword"],
      message: "Current password or verification code is required",
    },
  )
  .refine(
    (value) => !value.currentPassword || value.currentPassword !== value.newPassword,
    {
      path: ["newPassword"],
      message: "Choose a password different from your current one",
    },
  );

export const resetRequestSchema = z.object({
  email: emailSchema,
});

export const resetConfirmSchema = z.object({
  email: emailSchema,
  code: otpCodeSchema,
  newPassword: passwordSchema,
});

/* ------------------------------------------------------------------ */
/* Response types                                                      */
/* ------------------------------------------------------------------ */

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendOtpInput = z.infer<typeof resendOtpSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ResetRequestInput = z.infer<typeof resetRequestSchema>;
export type ResetConfirmInput = z.infer<typeof resetConfirmSchema>;

/* ------------------------------------------------------------------ */
/* Transcripts                                                         */
/* ------------------------------------------------------------------ */

export const transcriptTitleSchema = z
  .string({ error: "Title is required" })
  .trim()
  .min(1, "Title is required")
  .max(120, "Use at most 120 characters");

export const renameTranscriptSchema = z.object({ title: transcriptTitleSchema });

export type RenameTranscriptInput = z.infer<typeof renameTranscriptSchema>;

const AUDIO_MIME_RE = /^audio\/(webm|mp4|ogg)(;[a-z0-9=._-]+)*$/i;

export const startRecordingSchema = z.object({
  mime: z
    .string({ error: "A recorder mime type is required" })
    .trim()
    .max(80, "Mime type is too long")
    .regex(AUDIO_MIME_RE, "Unsupported audio container"),
  engine: z.enum(["whisper", "gemini", "whistle"]).optional(),
});

export const finishRecordingSchema = z.object({
  durationMs: z.coerce
    .number({ error: "Duration is required" })
    .int("Duration must be whole milliseconds")
    .min(0, "Duration cannot be negative")
    .max(3_600_000, "Recordings are capped at one hour"),
});

export type StartRecordingInput = z.infer<typeof startRecordingSchema>;
export type FinishRecordingInput = z.infer<typeof finishRecordingSchema>;
export type TranscriptStatus = "recording" | "ready" | "failed";

export type SegmentDTO = {
  id: string;
  seq: number;
  text: string;
  startMs: number;
  endMs: number;
};

/** Server → browser messages on the live transcription socket. */
export type StreamEvent =
  | { type: "ready"; transcriptId: string }
  | { type: "segment"; segment: SegmentDTO }
  | { type: "interim"; text: string }
  | { type: "error"; message: string }
  | { type: "rotate" }
  | { type: "done" };

/** Browser → server: binary frames are 16 kHz mono PCM (Int16LE); JSON frames are control. */
export type StreamCommand = { type: "stop" };

export type TranscriptDTO = {
  id: string;
  title: string;
  status: TranscriptStatus;
  language: string | null;
  engine: "groq-whisper" | "gemini-live" | "whistle" | null;
  durationMs: number;
  audioAvailable: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TranscriptListResponse = {
  items: TranscriptDTO[];
  nextCursor: string | null;
};

export type TranscriptResponse = { transcript: TranscriptDTO; segments?: SegmentDTO[] };

export type UserDTO = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  emailVerifiedAt: string | null;
  createdAt: string;
};

export type MeResponse = { user: UserDTO };
export type PendingResponse = { status: "pending_verification" };
export type MessageResponse = { status: "accepted" };

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** First message per field, for form errors. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
