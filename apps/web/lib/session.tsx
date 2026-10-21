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
import { api, type UserDTO } from "@/lib/api";

type SessionState = {
  user: UserDTO | null;
  loading: boolean;
  reload: () => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<UserDTO | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const me = await api.me();
      setUser(me.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<SessionState>(
    () => ({
      user,
      loading,
      reload,
      logout: async () => {
        await api.logout().catch(() => {});
        setUser(null);
        router.replace("/login");
      },
      logoutAll: async () => {
        await api.logoutAll().catch(() => {});
        setUser(null);
        router.replace("/login");
      },
    }),
    [user, loading, reload, router],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside SessionProvider");
  return context;
}
