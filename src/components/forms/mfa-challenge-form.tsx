"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { verifyMfaChallengeAction } from "@/features/identity-access/server/auth-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";

/**
 * Step-up screen between login and a staff destination: shown when the
 * account has a verified TOTP factor but the just-created session is still
 * aal1. `verifyMfaChallengeAction` both opens and verifies the challenge in
 * one call (`supabase.auth.mfa.challengeAndVerify`), so there is no separate
 * "send challenge" step here - entering a valid code is enough to step the
 * session up to aal2.
 */
export function MfaChallengeForm({
  factorId,
  nextPath,
}: {
  factorId: string;
  nextPath: string;
}) {
  const t = useTranslations("auth.mfaChallenge");
  const tRoot = useTranslations();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await verifyMfaChallengeAction({ factorId, code });
    setPending(false);
    if (!result.ok) {
      // `messageKey` is a dynamic full path (e.g. "errors.identity.auth.mfaVerifyFailed");
      // next-intl's typed `t()` only accepts literal keys, so this is cast at the call site.
      setError(tRoot(result.messageKey as never));
      return;
    }
    router.push(nextPath);
  }

  return (
    <section className="mfa-challenge flex w-full max-w-xs flex-col gap-5 rounded-lg border border-border bg-card p-6 shadow-sm">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <form onSubmit={onSubmit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="mfa-challenge-code">{t("codeLabel")}</FieldLabel>
            <Input
              id="mfa-challenge-code"
              inputMode="numeric"
              pattern="\d{6}"
              autoComplete="one-time-code"
              autoFocus
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={6}
              aria-invalid={Boolean(error)}
            />
          </Field>
          {error ? <FieldError>{error}</FieldError> : null}
          <Field>
            <Button type="submit" disabled={pending || code.length !== 6}>
              {pending ? t("submitting") : t("submit")}
            </Button>
            <FieldDescription className="text-center">{t("hint")}</FieldDescription>
          </Field>
        </FieldGroup>
      </form>
    </section>
  );
}
