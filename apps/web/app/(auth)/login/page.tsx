"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, type LoginInput } from "@stt/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ApiError, api } from "@/lib/api";
import { applyApiError } from "@/lib/form";
import { saveCachedUser } from "@/lib/session";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const nextPath = params.get("next") ?? "/";
  const [formError, setFormError] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const resetDone = params.get("reset") === "1";
  const changedDone = params.get("changed") === "1";

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginInput) {
    setFormError(null);
    setUnverifiedEmail(null);
    try {
      const res = await api.login(values);
      saveCachedUser(res.user);
      window.location.href = nextPath;
    } catch (error) {
      if (error instanceof ApiError && error.code === "EMAIL_UNVERIFIED") {
        setUnverifiedEmail(values.email);
        setFormError(error.message);
        return;
      }
      setFormError(applyApiError(error, setError));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Sign in to continue.</CardDescription>
      </CardHeader>
      <form method="post" onSubmit={handleSubmit(onSubmit)} noValidate>
        <CardContent className="space-y-4">
          {resetDone ? (
            <Alert variant="success">Password updated. Sign in with your new password.</Alert>
          ) : null}
          {changedDone ? (
            <Alert variant="success">Password changed. All sessions were signed out.</Alert>
          ) : null}
          {formError ? (
            <Alert variant="error">
              {formError}
              {unverifiedEmail ? (
                <>
                  {" "}
                  <Link
                    href={`/verify-email?email=${encodeURIComponent(unverifiedEmail)}`}
                    className="underline underline-offset-2"
                  >
                    Verify now
                  </Link>
                </>
              ) : null}
            </Alert>
          ) : null}
          <FormField id="email" label="Email" error={errors.email?.message}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              invalid={Boolean(errors.email)}
              {...register("email")}
            />
          </FormField>
          <FormField id="password" label="Password" error={errors.password?.message}>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              invalid={Boolean(errors.password)}
              {...register("password")}
            />
          </FormField>
          <div className="text-right text-sm">
            <Link href="/forgot-password" className="text-slate-500 hover:underline">
              Forgot password?
            </Link>
          </div>
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-3">
          <Button type="submit" loading={isSubmitting} className="w-full">
            Sign in
          </Button>
          <p className="text-center text-sm text-slate-500">
            New here?{" "}
            <Link href="/signup" className="font-medium text-slate-900 underline-offset-4 hover:underline dark:text-slate-100">
              Create an account
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
