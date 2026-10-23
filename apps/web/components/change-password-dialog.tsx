"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { changePasswordSchema, type ChangePasswordInput } from "@stt/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { applyApiError } from "@/lib/form";
import { saveCachedUser } from "@/lib/session";
const RESEND_SECONDS = 60;

export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", code: "", newPassword: "" },
  });

  useEffect(() => {
    if (open) return;
    setFormError(null);
    setNotice(null);
  }, [open]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function requestCode() {
    setFormError(null);
    setSendingCode(true);
    try {
      await api.requestPasswordChangeOtp();
      setCodeSent(true);
      setCooldown(RESEND_SECONDS);
      setNotice("Code sent to your email.");
    } catch (error) {
      setFormError(applyApiError(error, setError));
    } finally {
      setSendingCode(false);
    }
  }

  async function onSubmit(values: ChangePasswordInput) {
    setFormError(null);
    try {
      await api.changePassword(values);
      setNotice("Password updated successfully.");
      reset();
      setCodeSent(false);
      setTimeout(() => {
        onOpenChange(false);
        setNotice(null);
      }, 1000);
    } catch (error) {
      setFormError(applyApiError(error, setError));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            We email a 6-digit code to confirm the change. Every other session is signed out.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}
          {notice ? <Alert variant="success">{notice}</Alert> : null}

          <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
            <span className="text-slate-600 dark:text-slate-400">
              {codeSent ? "Code sent to your inbox" : "Step 1 · request a code"}
            </span>
            <Button
              type="button"
              size="sm"
              variant={codeSent ? "outline" : "primary"}
              onClick={requestCode}
              loading={sendingCode}
              disabled={cooldown > 0}
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : codeSent ? "Resend" : "Send code"}
            </Button>
          </div>

          <form id="change-password-form" method="post" onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <FormField id="currentPassword" label="Current password" error={errors.currentPassword?.message}>
              <Input
                id="currentPassword"
                type="password"
                autoComplete="current-password"
                invalid={Boolean(errors.currentPassword)}
                {...register("currentPassword")}
              />
            </FormField>
            <FormField id="code" label="Email code" error={errors.code?.message}>
              <Input
                id="code"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                className="text-center tracking-[0.5em]"
                invalid={Boolean(errors.code)}
                {...register("code")}
              />
            </FormField>
            <FormField
              id="newPassword"
              label="New password"
              hint="10+ characters, letters and numbers"
              error={errors.newPassword?.message}
            >
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                invalid={Boolean(errors.newPassword)}
                {...register("newPassword")}
              />
            </FormField>
          </form>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} type="button">
            Cancel
          </Button>
          <Button type="submit" form="change-password-form" loading={isSubmitting}>
            Update password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
