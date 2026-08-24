"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
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
import { toLocaleAgnostic } from "@/lib/auth/next-path";
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
  const t = useTranslations("auth.login");
  const tRoot = useTranslations();
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
      // `messageKey` is a dynamic full path (e.g. "errors.identity.auth.invalidCredentials");
      // next-intl's typed `t()` only accepts literal keys, so this is cast at the call site.
      setError(tRoot(result.messageKey as never));
      return;
    }
    // Always proceed to the destination; MFA enrollment is optional.
    // Users can enable 2FA later from their security settings.
    //
    // `next` is whatever page the guard bounced them off, but it arrives via
    // the query string, so anyone can craft a /login?next=... link - it is
    // re-validated here rather than trusted. When it fails validation, fall
    // back to the server's redirect so signed-in users never get bounced
    // through "/" (which has a /signup fallback).
    //
    // `toLocaleAgnostic` validates and strips any locale prefix in one step:
    // this router comes from `@/i18n/navigation` and adds its own prefix
    // unconditionally under `localePrefix: 'always'`, so a prefixed value
    // passed straight through would double up into "/ms/ms/...".
    const destination = toLocaleAgnostic(next) ?? result.data.redirectTo;
    // `result.data.locale` is the account's just-synced locale, which may
    // differ from the locale this login page happened to be prefixed with
    // (e.g. signing in on a new device). Passing it explicitly keeps the
    // post-login URL and the cookie in agreement, the same way
    // /auth/callback already does; when the sync itself failed, fall back
    // to the router's default of the current URL locale.
    if (result.data.locale) {
      router.push(destination, { locale: result.data.locale });
    } else {
      router.push(destination);
    }
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
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-balance text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <Field>
          <FieldLabel htmlFor="email">{t("emailLabel")}</FieldLabel>
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
          <FieldLabel htmlFor="password">{t("passwordLabel")}</FieldLabel>
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
            {pending ? t("submitting") : t("submit")}
          </Button>
          <FieldDescription className="text-center">
            {t("noAccount")}{" "}
            <Link href="/signup" className="underline underline-offset-4">
              {t("signUpLink")}
            </Link>
          </FieldDescription>
        </Field>
        <FieldDescription className="text-center">
          {t("mfaHint")}
        </FieldDescription>
      </FieldGroup>
    </form>
  );
}
