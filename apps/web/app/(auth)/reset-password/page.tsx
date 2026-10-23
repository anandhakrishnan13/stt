"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { resetConfirmSchema } from "@stt/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { api } from "@/lib/api";
import { applyApiError } from "@/lib/form";

const formSchema = resetConfirmSchema
  .extend({
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

type FormValues = z.infer<typeof formSchema>;

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: params.get("email") ?? "",
      code: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  async function onSubmit(values: FormValues) {
    setFormError(null);
    try {
      await api.confirmPasswordReset({
        email: values.email,
        code: values.code,
        newPassword: values.newPassword,
      });
      router.push("/login?reset=1");
    } catch (error) {
      setFormError(applyApiError(error, setError));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a new password</CardTitle>
        <CardDescription>Enter the emailed code and your new password.</CardDescription>
      </CardHeader>
      <form method="post" onSubmit={handleSubmit(onSubmit)} noValidate>
        <CardContent className="space-y-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}
          <FormField id="email" label="Email" error={errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" invalid={Boolean(errors.email)} {...register("email")} />
          </FormField>
          <FormField id="code" label="Reset code" error={errors.code?.message}>
            <Input
              id="code"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              className="text-center text-lg tracking-[0.5em]"
              invalid={Boolean(errors.code)}
              {...register("code")}
            />
          </FormField>
          <FormField
            id="newPassword"
            label="New password"
            hint="6+ characters, letters and numbers"
            error={errors.newPassword?.message}
          >
            <PasswordInput
              id="newPassword"
              autoComplete="new-password"
              invalid={Boolean(errors.newPassword)}
              {...register("newPassword")}
            />
          </FormField>
          <FormField id="confirmPassword" label="Confirm password" error={errors.confirmPassword?.message}>
            <PasswordInput
              id="confirmPassword"
              autoComplete="new-password"
              invalid={Boolean(errors.confirmPassword)}
              {...register("confirmPassword")}
            />
          </FormField>
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-3">
          <Button type="submit" loading={isSubmitting} className="w-full">
            Update password
          </Button>
          <p className="text-center text-sm text-slate-500">
            <Link href="/login" className="hover:underline">
              Back to sign in
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
