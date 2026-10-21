"use client";

import { BadgeCheck, KeyRound, Mic } from "lucide-react";
import { ChangePasswordDialog } from "@/components/change-password-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSession } from "@/lib/session";

export default function DashboardPage() {
  const { user, loading, logoutAll } = useSession();

  if (loading || !user) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-64 rounded bg-slate-200 dark:bg-slate-800" />
        <div className="h-40 rounded-xl bg-slate-200 dark:bg-slate-800" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back, {user.firstName}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Your account is ready. The transcription workspace lands in the next slice.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BadgeCheck className="size-4 text-emerald-600" />
              Account
            </CardTitle>
            <CardDescription>Identity used for sign-in.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-slate-500">Name</span>
              <span className="font-medium">
                {user.firstName} {user.lastName}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-500">Email</span>
              <span className="font-medium">{user.email}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-500">Verified</span>
              <span className="font-medium">
                {user.emailVerifiedAt
                  ? new Date(user.emailVerifiedAt).toLocaleDateString()
                  : "Not yet"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="size-4" />
              Security
            </CardTitle>
            <CardDescription>Rotating sessions, argon2id hashes, OTP-gated changes.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <ChangePasswordDialog>
              <Button variant="outline" size="sm">
                Change password
              </Button>
            </ChangePasswordDialog>
            <Button variant="ghost" size="sm" onClick={() => void logoutAll()}>
              Sign out everywhere
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mic className="size-4" />
            Live transcription — next slice
          </CardTitle>
          <CardDescription>
            The audio pipeline is not wired yet. It will stream 16 kHz PCM from an AudioWorklet to
            the Fastify gateway, relay to Gemini Live, and persist finalized segments.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
