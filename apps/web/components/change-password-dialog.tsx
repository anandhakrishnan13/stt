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
import { PasswordInput } from "@/components/ui/password-input";
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
  const [forgotPassword, setForgotPassword] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    setValue,
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
    setForgotPassword(false);
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
    if (!forgotPassword && (!values.currentPassword || values.currentPassword.trim() === "")) {
      setError("currentPassword", { message: "Current password is required" });
      return;
    }
    if (forgotPassword && (!values.code || values.code.trim().length !== 6)) {
      setError("code", { message: "Enter the 6-digit code sent to your email" });
      return;
    }
    try {
      const payload: ChangePasswordInput = forgotPassword
        ? { code: values.code, newPassword: values.newPassword }
        : { currentPassword: values.currentPassword, newPassword: values.newPassword };
      await api.changePassword(payload);
      setNotice("Password updated successfully.");
      reset();
      setCodeSent(false);
      setForgotPassword(false);
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
            {forgotPassword
              ? "Request a 6-digit code to verify your identity. Other sessions will be signed out."
              : "Enter your current password and choose a new one. Other sessions will be signed out."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}
          {notice ? <Alert variant="success">{notice}</Alert> : null}

          {forgotPassword && (
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
          )}

          <form id="change-password-form" method="post" onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                id="forgotPassword"
                checked={forgotPassword}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setForgotPassword(checked);
                  setFormError(null);
                  if (checked) {
                    setValue("currentPassword", "");
                  } else {
                    setValue("code", "");
                    setCodeSent(false);
                  }
                }}
                className="size-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500 dark:border-slate-700 dark:bg-slate-900"
              />
              Forgot current password?
            </label>

            {!forgotPassword && (
              <FormField id="currentPassword" label="Current password" error={errors.currentPassword?.message}>
                <PasswordInput
                  id="currentPassword"
                  autoComplete="current-password"
                  invalid={Boolean(errors.currentPassword)}
                  {...register("currentPassword")}
                />
              </FormField>
            )}
            {forgotPassword && (
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
            )}
            <FormField
              id="newPassword"
              label="New password"
              hint="10+ characters, letters and numbers"
              error={errors.newPassword?.message}
            >
              <PasswordInput
                id="newPassword"
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
