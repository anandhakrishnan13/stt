import type {
  ChangePasswordInput,
  LoginInput,
  MeResponse,
  ResetConfirmInput,
  SignupInput,
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
};

export type { UserDTO };
