"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { verifyEmailSchema, type VerifyEmailInput } from "@stt/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { applyApiError } from "@/lib/form";

const RESEND_SECONDS = 60;

function VerifyEmailForm() {
  const router = useRouter();
  const params = useSearchParams();
  const emailFromQuery = params.get("email") ?? "";
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const {
    register,
    handleSubmit,
    setError,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<VerifyEmailInput>({
    resolver: zodResolver(verifyEmailSchema),
    defaultValues: { email: emailFromQuery, code: "" },
  });

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function onSubmit(values: VerifyEmailInput) {
    setFormError(null);
    setNotice(null);
    try {
      await api.verifyEmail(values);
      router.push("/dashboard");
    } catch (error) {
      setFormError(applyApiError(error, setError));
    }
  }

  async function resend() {
    const email = getValues("email");
    setFormError(null);
    try {
      await api.resendOtp(email);
      setCooldown(RESEND_SECONDS);
      setNotice("A new code is on its way.");
    } catch (error) {
      setFormError(applyApiError(error, setError));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verify your email</CardTitle>
        <CardDescription>
          Enter the 6-digit code we sent. It expires in 10 minutes.
        </CardDescription>
      </CardHeader>
      <form method="post" onSubmit={handleSubmit(onSubmit)} noValidate>
        <CardContent className="space-y-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}
          {notice ? <Alert variant="success">{notice}</Alert> : null}
          <FormField id="email" label="Email" error={errors.email?.message}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              invalid={Boolean(errors.email)}
              {...register("email")}
            />
          </FormField>
          <FormField id="code" label="Verification code" error={errors.code?.message}>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              className="text-center text-lg tracking-[0.5em]"
              invalid={Boolean(errors.code)}
              {...register("code")}
            />
          </FormField>
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-3">
          <Button type="submit" loading={isSubmitting} className="w-full">
            Verify and continue
          </Button>
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={resend}
              disabled={cooldown > 0}
              className="font-medium text-slate-900 underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 dark:text-slate-100"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
            </button>
            <Link href="/login" className="text-slate-500 hover:underline">
              Back to sign in
            </Link>
          </div>
        </CardFooter>
      </form>
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailForm />
    </Suspense>
  );
}
