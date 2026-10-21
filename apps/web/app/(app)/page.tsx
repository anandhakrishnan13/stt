"use client";

import { AudioLines } from "lucide-react";
import { Composer } from "@/components/workspace/composer";
import { useSession } from "@/lib/session";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function WorkspacePage() {
  const { user } = useSession();

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-10">
        <div className="w-full max-w-xl text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
            <AudioLines className="size-5" aria-hidden />
          </span>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">
            {greeting()}
            {user ? `, ${user.firstName}` : ""}
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Speak a sentence in Hindi, English, or a mix of both.
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-500">
            Finished sentences will land in your history, ready to rename or delete.
          </p>
        </div>
      </div>
      <Composer />
    </main>
  );
}
