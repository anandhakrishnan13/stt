"use client";

import { KeyRound, LogOut, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSession } from "@/lib/session";
import { displayName, formatTranscriptDate, initials } from "@/lib/transcripts";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
  onChangePassword,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChangePassword: () => void;
}) {
  const { user, logout, logoutAll } = useSession();
  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Account settings</DialogTitle>
          <DialogDescription>Profile, sessions and access for this workspace.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-full bg-slate-900 text-sm font-semibold text-white dark:bg-slate-100 dark:text-slate-900"
          >
            {initials(user.firstName, user.lastName)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{displayName(user.firstName, user.lastName)}</p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
          </div>
          {user.emailVerifiedAt ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
              <ShieldCheck className="size-3" aria-hidden />
              Verified
            </span>
          ) : null}
        </div>

        <dl className="mt-4 divide-y divide-slate-100 text-sm dark:divide-slate-800">
          <Row label="Member since">{formatTranscriptDate(user.createdAt)}</Row>
          <Row label="Email verified">
            {user.emailVerifiedAt ? formatTranscriptDate(user.emailVerifiedAt) : "Not yet"}
          </Row>
          <Row label="Sessions">15-minute access · rotating refresh</Row>
        </dl>

        <DialogFooter className="flex-wrap justify-between gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onOpenChange(false);
              onChangePassword();
            }}
          >
            <KeyRound className="size-4" aria-hidden />
            Change password
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void logoutAll()}>
              Sign out everywhere
            </Button>
            <Button type="button" size="sm" onClick={() => void logout()}>
              <LogOut className="size-4" aria-hidden />
              Sign out
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
