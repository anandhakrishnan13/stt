"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { resetRequestSchema, type ResetRequestInput } from "@stt/shared";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { applyApiError } from "@/lib/form";

export default function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetRequestInput>({
    resolver: zodResolver(resetRequestSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: ResetRequestInput) {
    setFormError(null);
    try {
      await api.requestPasswordReset(values.email);
      setSentTo(values.email);
    } catch (error) {
      setFormError(applyApiError(error, setError));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>
          We will email a 6-digit code if an account exists for that address.
        </CardDescription>
      </CardHeader>
      {sentTo ? (
        <CardContent className="space-y-4">
          <Alert variant="success">
            If <span className="font-medium">{sentTo}</span> has an account, a code is on its way.
          </Alert>
          <Button className="w-full" onClick={() => { window.location.href = `/reset-password?email=${encodeURIComponent(sentTo)}`; }}>
            Enter the code
          </Button>
        </CardContent>
      ) : (
        <form method="post" onSubmit={handleSubmit(onSubmit)} noValidate>
          <CardContent className="space-y-4">
            {formError ? <Alert variant="error">{formError}</Alert> : null}
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
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-3">
            <Button type="submit" loading={isSubmitting} className="w-full">
              Send reset code
            </Button>
            <p className="text-center text-sm text-slate-500">
              <Link href="/login" className="hover:underline">
                Back to sign in
              </Link>
            </p>
          </CardFooter>
        </form>
      )}
    </Card>
  );
}
