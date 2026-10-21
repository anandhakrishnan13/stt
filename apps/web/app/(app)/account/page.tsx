"use client";

import { ChangePasswordDialog } from "@/components/change-password-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSession } from "@/lib/session";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-2 text-sm last:border-0 dark:border-slate-800">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export default function AccountPage() {
  const { user, loading, logoutAll } = useSession();

  if (loading || !user) {
    return <div className="h-40 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Profile and session controls.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
          <CardDescription>Managed by the account owner.</CardDescription>
        </CardHeader>
        <CardContent>
          <Row label="First name" value={user.firstName} />
          <Row label="Last name" value={user.lastName} />
          <Row label="Email" value={user.email} />
          <Row
            label="Email verified"
            value={user.emailVerifiedAt ? new Date(user.emailVerifiedAt).toLocaleString() : "No"}
          />
          <Row label="Member since" value={new Date(user.createdAt).toLocaleString()} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sessions</CardTitle>
          <CardDescription>
            Access tokens live 15 minutes; refresh tokens rotate on every use. Changing the password
            revokes all of them.
          </CardDescription>
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
  );
}
