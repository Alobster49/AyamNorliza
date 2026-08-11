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

/**
 * Optional local-only quick-fill logins for the dev login form.
 *
 * Credentials are read from the environment (`.env.local`, which is
 * gitignored) and the whole block is compiled out of production builds --
 * these values must never be committed. Format:
 *
 *   NEXT_PUBLIC_DEV_LOGINS="Owner:owner@example.com:password,Admin:a@b.c:pw"
 */
const devLogins =
  process.env.NODE_ENV === "production"
    ? []
    : (process.env.NEXT_PUBLIC_DEV_LOGINS ?? "")
        .split(",")
        .map((entry) => entry.split(":"))
        .filter(
          (parts): parts is [string, string, string] => parts.length === 3,
        )
        .map(([label, email, password]) => ({ label, email, password }));

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
        {devLogins.length > 0 ? (
          <Field>
            <div className="flex gap-2">
              {devLogins.map((login) => (
                <Button
                  key={login.label}
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEmail(login.email);
                    setPassword(login.password);
                  }}
                  className="flex-1 text-xs"
                >
                  Dev: {login.label}
                </Button>
              ))}
            </div>
          </Field>
        ) : null}
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
