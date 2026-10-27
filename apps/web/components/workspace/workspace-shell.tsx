"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Sidebar } from "@/components/workspace/sidebar";
import { saveCachedUser, useSession } from "@/lib/session";

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const { user, loading, unauthenticated, error, reload } = useSession();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (unauthenticated) {
      saveCachedUser(null);
      window.location.href = "/login";
    }
  }, [unauthenticated]);

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-slate-500">
        Loading your workspace…
      </div>
    );
  }

  if (error && !user) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-slate-600 dark:text-slate-300">{error}</p>
        <Button type="button" variant="outline" onClick={() => void reload()}>
          Try again
        </Button>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-dvh overflow-hidden bg-white dark:bg-slate-950">
      <aside className="hidden w-[268px] shrink-0 md:flex">
        <Sidebar />
      </aside>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent aria-describedby={undefined}>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 px-3 md:hidden dark:border-slate-800">
          <button
            type="button"
            aria-label="Open navigation"
            onClick={() => setNavOpen(true)}
            className="rounded-md p-1.5 text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Menu className="size-5" aria-hidden />
          </button>
          <Link href="/new" className="text-sm font-semibold tracking-tight hover:opacity-80">
            Speech to Text
          </Link>
        </header>

        {children}
      </div>
    </div>
  );
}
