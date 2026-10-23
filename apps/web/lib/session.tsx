"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError, api, type UserDTO } from "@/lib/api";

const RETRY_DELAYS_MS = [500, 1500];
const SESSION_CACHE_KEY = "st_cached_user";

export function saveCachedUser(user: UserDTO | null): void {
  if (typeof window === "undefined") return;
  try {
    if (user) {
      sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(user));
    } else {
      sessionStorage.removeItem(SESSION_CACHE_KEY);
    }
  } catch {}
}

export function getCachedUser(): UserDTO | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserDTO;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  window.setTimeout(resolve, ms);
  return promise;
}

type SessionState = {
  user: UserDTO | null;
  loading: boolean;
  /** True only when the server rejected the session (401 after refresh). */
  unauthenticated: boolean;
  /** Set when the session could not be loaded for a reason other than 401. */
  error: string | null;
  reload: () => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<UserDTO | null>(() => getCachedUser());
  const [loading, setLoading] = useState<boolean>(() => getCachedUser() === null);
  const [unauthenticated, setUnauthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * A 500, 429 or dropped connection is not "you are signed out": bouncing to
   * /login there throws away a session the user still has. Only a 401 (which
   * apiRequest already tried to refresh) ends the session; anything else is
   * retried, then surfaced as an error with a retry action.
   */
  const reload = useCallback(async () => {
    if (!getCachedUser()) {
      setLoading(true);
    }
    setError(null);
    for (let attempt = 0; ; attempt += 1) {
      try {
        const me = await api.me();
        setUser(me.user);
        saveCachedUser(me.user);
        setUnauthenticated(false);
        break;
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 401) {
          setUser(null);
          saveCachedUser(null);
          setUnauthenticated(true);
          break;
        }
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined) {
          setError("Could not reach the server. Check your connection and try again.");
          break;
        }
        await sleep(delay);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<SessionState>(
    () => ({
      user,
      loading,
      unauthenticated,
      error,
      reload,
      logout: async () => {
        await api.logout().catch(() => {});
        setUser(null);
        saveCachedUser(null);
        setUnauthenticated(true);
        router.replace("/login");
      },
      logoutAll: async () => {
        await api.logoutAll().catch(() => {});
        setUser(null);
        saveCachedUser(null);
        setUnauthenticated(true);
        router.replace("/login");
      },
    }),
    [user, loading, unauthenticated, error, reload, router],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside SessionProvider");
  return context;
}
