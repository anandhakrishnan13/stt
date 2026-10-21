import type {
  ChangePasswordInput,
  LoginInput,
  MeResponse,
  RenameTranscriptInput,
  ResetConfirmInput,
  SignupInput,
  TranscriptListResponse,
  TranscriptResponse,
  UserDTO,
  VerifyEmailInput,
} from "@stt/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Json = Record<string, unknown>;

async function refreshSession(): Promise<boolean> {
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    credentials: "include",
  });
  return res.ok;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (init.body !== undefined && headers["content-type"] === undefined) {
    headers["content-type"] = "application/json";
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers,
  });

  const isAuthPath = path === "/auth/refresh" || path === "/auth/login";
  if (res.status === 401 && retry && !isAuthPath) {
    if (await refreshSession()) return apiRequest<T>(path, init, false);
  }

  if (res.status === 204) return undefined as T;

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (body as { error?: { code?: string; message?: string; details?: unknown } } | null)
      ?.error;
    throw new ApiError(
      res.status,
      error?.code ?? "INTERNAL",
      error?.message ?? "Request failed",
      error?.details,
    );
  }

  return body as T;
}

function post<T>(path: string, payload?: Json): Promise<T> {
  return apiRequest<T>(path, {
    method: "POST",
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

export const api = {
  signup: (input: SignupInput) => post<{ status: string }>("/auth/signup", input),
  verifyEmail: (input: VerifyEmailInput) => post<MeResponse>("/auth/verify-email", input),
  resendOtp: (email: string) => post<{ status: string }>("/auth/resend-otp", { email }),
  login: (input: LoginInput) => post<MeResponse>("/auth/login", input),
  logout: () => post<void>("/auth/logout"),
  logoutAll: () => post<void>("/auth/logout-all"),
  me: () => apiRequest<MeResponse>("/auth/me"),
  requestPasswordChangeOtp: () => post<{ status: string }>("/auth/password/change/otp"),
  changePassword: (input: ChangePasswordInput) => post<void>("/auth/password/change", input),
  requestPasswordReset: (email: string) =>
    post<{ status: string }>("/auth/password/reset/request", { email }),
  confirmPasswordReset: (input: ResetConfirmInput) =>
    post<void>("/auth/password/reset/confirm", input),

  listTranscripts: (params: { q?: string; cursor?: string; limit?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.q) search.set("q", params.q);
    if (params.cursor) search.set("cursor", params.cursor);
    if (params.limit) search.set("limit", String(params.limit));
    const suffix = search.toString();
    return apiRequest<TranscriptListResponse>(`/transcripts${suffix ? `?${suffix}` : ""}`);
  },
  getTranscript: (id: string) => apiRequest<TranscriptResponse>(`/transcripts/${id}`),
  renameTranscript: (id: string, input: RenameTranscriptInput) =>
    apiRequest<TranscriptResponse>(`/transcripts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteTranscript: (id: string) =>
    apiRequest<void>(`/transcripts/${id}`, { method: "DELETE" }),

  startRecording: (mime: string) => post<TranscriptResponse>("/transcripts", { mime }),
  uploadChunk: (id: string, seq: number, chunk: Blob) =>
    apiRequest<{ chunkSeq: number; bytes: number }>(`/transcripts/${id}/chunks?seq=${seq}`, {
      method: "POST",
      body: chunk,
      headers: { "content-type": "application/octet-stream" },
    }),
  finishRecording: (id: string, durationMs: number) =>
    post<TranscriptResponse>(`/transcripts/${id}/finish`, { durationMs }),
  abortRecording: (id: string) => post<void>(`/transcripts/${id}/abort`),
};

/** Same-origin cookie auth covers the media element too. */
export function audioUrl(id: string): string {
  return `${API_URL}/transcripts/${id}/audio`;
}

export type { UserDTO };
