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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  CONSOLE_ACCOUNTS,
  REALWORLD_DRIVER_ACCOUNTS,
} from "@/features/data-console/lib/accounts";
import { loginAction } from "@/features/identity-access/server/auth-actions";
import { toLocaleAgnostic } from "@/lib/auth/next-path";
import { cn } from "@/lib/utils";

/**
 * Local-only quick-fill logins for the dev login form.
 *
 * Two sources, both compiled out of production builds by the
 * `NODE_ENV === "production"` guard, so neither the seeded password nor any
 * personal credential can reach a shipped bundle:
 *
 * 1. The data console's seeded accounts -- one per role the app gates on --
 *    which all share the seeded password. Picking one fills the form, so
 *    switching between owner / seller / warehouse / driver during
 *    development is two clicks instead of retyping an email each time.
 * 2. `NEXT_PUBLIC_DEV_LOGINS`, read from `.env.local` (gitignored) for any
 *    extra account that is not seeded. Format:
 *
 *      NEXT_PUBLIC_DEV_LOGINS="Owner:owner@example.com:password,Admin:a@b.c:pw"
 *
 * The password is written as a literal here rather than imported so that
 * dead-code elimination drops it entirely; it mirrors `CONSOLE_PASSWORD` in
 * `features/data-console/server/actions.ts`.
 */
const devLogins =
  process.env.NODE_ENV === "production"
    ? []
    : [
        ...CONSOLE_ACCOUNTS.filter((account) => account.role !== "driver").map(
          (account) => ({
            label: account.displayName,
            role: account.role as string,
            email: account.email,
            password: "password123",
          }),
        ),
        ...(process.env.NEXT_PUBLIC_DEV_LOGINS ?? "")
          .split(",")
          .map((entry) => entry.split(":"))
          .filter(
            (parts): parts is [string, string, string] => parts.length === 3,
          )
          .map(([label, email, password]) => ({
            label,
            role: "custom",
            email,
            password,
          })),
      ];

/**
 * The 32-driver fleet from the real-world seed (30 truck drivers + 2 cover-pool drivers),
 * folded into their own collapsed section so the picker stays usable. driver1/driver2 also cover
 * the demo seed (same emails); drivers 3-30 only log in after the
 * real-world seed has run.
 */
const devDriverLogins =
  process.env.NODE_ENV === "production"
    ? []
    : REALWORLD_DRIVER_ACCOUNTS.map((driver) => ({
        label: driver.displayName,
        role: driver.truckCode ?? "Cover pool",
        email: driver.email,
        password: "password123",
      }));

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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [driversOpen, setDriversOpen] = useState(false);

  function pickLogin(login: { email: string; password: string }) {
    setEmail(login.email);
    setPassword(login.password);
    setError(null);
    setPickerOpen(false);
  }

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
    // An account with a verified TOTP factor whose session hasn't stepped up
    // to aal2 yet must clear the challenge screen before reaching its real
    // destination - carry `destination` through as `?next=` the same way the
    // login page itself received it, so the challenge screen lands the user
    // exactly where they were headed. Enrollment stays optional: this only
    // fires for accounts that already have a verified factor.
    const target = result.data.mfaChallengeRequired
      ? `/mfa/challenge?next=${encodeURIComponent(destination)}`
      : destination;
    // `result.data.locale` is the account's just-synced locale, which may
    // differ from the locale this login page happened to be prefixed with
    // (e.g. signing in on a new device). Passing it explicitly keeps the
    // post-login URL and the cookie in agreement, the same way
    // /auth/callback already does; when the sync itself failed, fall back
    // to the router's default of the current URL locale.
    if (result.data.locale) {
      router.push(target, { locale: result.data.locale });
    } else {
      router.push(target);
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
            <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
              <DialogTrigger asChild>
                <Button type="button" variant="outline" className="w-full text-xs">
                  Dev: pick an account
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle>Dev sign-in</DialogTitle>
                  <DialogDescription>
                    Fills the form with a seeded account. Local builds only —
                    run Seed demo data first if a login is rejected.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-1">
                  {devLogins.map((login) => (
                    <button
                      key={login.email}
                      type="button"
                      onClick={() => pickLogin(login)}
                      className="flex items-center justify-between gap-3 rounded-md border border-transparent px-3 py-2 text-left text-sm hover:border-border hover:bg-muted"
                    >
                      <span className="flex flex-col">
                        <span className="font-medium">{login.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {login.email}
                        </span>
                      </span>
                      <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {login.role}
                      </span>
                    </button>
                  ))}
                  {devDriverLogins.length > 0 ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setDriversOpen((open) => !open)}
                        aria-expanded={driversOpen}
                        className="mt-1 flex items-center justify-between gap-3 rounded-md border border-transparent px-3 py-2 text-left text-sm font-medium hover:border-border hover:bg-muted"
                      >
                        Drivers ({devDriverLogins.length})
                        <span className="text-xs text-muted-foreground">
                          {driversOpen ? "Hide" : "Show"}
                        </span>
                      </button>
                      {driversOpen ? (
                        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-md border p-1">
                          {devDriverLogins.map((login) => (
                            <button
                              key={login.email}
                              type="button"
                              onClick={() => pickLogin(login)}
                              className="flex items-center justify-between gap-3 rounded-md border border-transparent px-3 py-2 text-left text-sm hover:border-border hover:bg-muted"
                            >
                              <span className="flex flex-col">
                                <span className="font-medium">{login.label}</span>
                                <span className="text-xs text-muted-foreground">
                                  {login.email}
                                </span>
                              </span>
                              <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                {login.role}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </DialogContent>
            </Dialog>
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
