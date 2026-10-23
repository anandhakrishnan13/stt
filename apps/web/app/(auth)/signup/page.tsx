"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { signupSchema, type SignupInput } from "@stt/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { api } from "@/lib/api";
import { applyApiError } from "@/lib/form";

export default function SignupPage() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: { firstName: "", lastName: "", email: "", password: "" },
  });

  async function onSubmit(values: SignupInput) {
    setFormError(null);
    try {
      await api.signup(values);
      router.push(`/verify-email?email=${encodeURIComponent(values.email)}`);
    } catch (error) {
      setFormError(applyApiError(error, setError));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>We will email you a 6-digit code to verify the address.</CardDescription>
      </CardHeader>
      <form method="post" onSubmit={handleSubmit(onSubmit)} noValidate>
        <CardContent className="space-y-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}
          <div className="grid grid-cols-2 gap-3">
            <FormField id="firstName" label="First name" error={errors.firstName?.message}>
              <Input
                id="firstName"
                autoComplete="given-name"
                invalid={Boolean(errors.firstName)}
                aria-describedby="firstName-error"
                {...register("firstName")}
              />
            </FormField>
            <FormField id="lastName" label="Last name" error={errors.lastName?.message}>
              <Input
                id="lastName"
                autoComplete="family-name"
                invalid={Boolean(errors.lastName)}
                aria-describedby="lastName-error"
                {...register("lastName")}
              />
            </FormField>
          </div>
          <FormField id="email" label="Email" error={errors.email?.message}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              invalid={Boolean(errors.email)}
              aria-describedby="email-error"
              {...register("email")}
            />
          </FormField>
          <FormField
            id="password"
            label="Password"
            hint="6+ characters, letters and numbers"
            error={errors.password?.message}
          >
            <PasswordInput
              id="password"
              autoComplete="new-password"
              invalid={Boolean(errors.password)}
              aria-describedby="password-error"
              {...register("password")}
            />
          </FormField>
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-3">
          <Button type="submit" loading={isSubmitting} className="w-full">
            Create account
          </Button>
          <p className="text-center text-sm text-slate-500">
            Already registered?{" "}
            <Link href="/login" className="font-medium text-slate-900 underline-offset-4 hover:underline dark:text-slate-100">
              Sign in
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
