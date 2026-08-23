"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { signUpAction } from "@/features/identity-access/server/auth-actions";

export function SignupForm() {
  const t = useTranslations("auth.signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await signUpAction({ email, password, displayName });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (result.data.requiresEmailConfirm) {
      setNeedsConfirm(true);
    }
  }

  if (needsConfirm) {
    return (
      <section>
        <h1>{t("checkEmailTitle")}</h1>
        <p>{t("checkEmailBody", { email })}</p>
      </section>
    );
  }

  return (
    <form onSubmit={onSubmit} className="auth-form">
      <h1>{t("title")}</h1>
      <p>{t("subtitle")}</p>
      <label>
        {t("emailLabel")}
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label>
        {t("displayNameLabel")}
        <input
          type="text"
          required
          minLength={1}
          maxLength={150}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </label>
      <label>
        {t("passwordLabel")}
        <input
          type="password"
          required
          minLength={12}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
