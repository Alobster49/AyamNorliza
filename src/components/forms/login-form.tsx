"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { loginAction } from "@/features/identity-access/server/auth-actions";
import { cn } from "@/lib/utils";

export function LoginForm({
  next,
  className,
}: {
  next?: string;
  className?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await loginAction({ email, password });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // Always proceed to the destination; MFA enrollment is optional.
    // Users can enable 2FA later from their security settings.
    // Prefer the explicit redirect returned by the server so signed-in users
    // never get bounced through "/" (which has a /signup fallback).
    router.push(next || result.data.redirectTo);
  }

  return (
    <form
      onSubmit={onSubmit}
      method="post"
      action=""
      className={cn("flex flex-col gap-6", className)}
    >
      <FieldGroup>
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-2xl font-bold">Sign in to your account</h1>
          <p className="text-balance text-sm text-muted-foreground">
            Enter your credentials to access AyamNorliza operations.
          </p>
        </div>
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            name="email"
            autoComplete="email"
            placeholder="name@example.com"
            required
            aria-invalid={Boolean(error)}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            minLength={1}
            aria-invalid={Boolean(error)}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        {error ? <FieldError>{error}</FieldError> : null}
        <Field>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEmail("admin@gmail.com");
                setPassword("Password123!");
              }}
              className="flex-1 text-xs"
            >
              Dev: Admin
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEmail("owner@gmail.com");
                setPassword("Ayamnorliza");
              }}
              className="flex-1 text-xs"
            >
              Dev: Owner
            </Button>
          </div>
        </Field>
        <Field>
          <Button type="submit" disabled={pending}>
            {pending ? "Signing in..." : "Sign in"}
          </Button>
          <FieldDescription className="text-center">
            Need an account?{" "}
            <Link href="/signup" className="underline underline-offset-4">
              Request access
            </Link>
          </FieldDescription>
        </Field>
        <FieldDescription className="text-center">
          Two-factor authentication can be enabled from security settings after sign in.
        </FieldDescription>
      </FieldGroup>
    </form>
  );
}
