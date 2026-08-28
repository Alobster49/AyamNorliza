"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { setPasswordAction } from "@/features/identity-access/server/auth-actions";

export function SetPasswordForm() {
  const t = useTranslations("auth.setPassword");
  const tRoot = useTranslations();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t("mismatch"));
      return;
    }
    setPending(true);
    // Server-validated (12 chars min, same policy as signup) - the
    // `minLength={12}` below is a UX nicety only, never the real guard.
    const result = await setPasswordAction({ password });
    setPending(false);
    if (!result.ok) {
      // `messageKey` is a dynamic full path (e.g. "errors.identity.auth.invalidSetPassword");
      // next-intl's typed `t()` only accepts literal keys, so this is cast at the call site.
      setError(tRoot(result.messageKey as never));
      return;
    }
    router.replace("/");
  }

  return (
    <form onSubmit={onSubmit} className="auth-form">
      <label>
        {t("passwordLabel")}
        <input
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label>
        {t("confirmLabel")}
        <input
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? t("saving") : t("submit")}
      </button>
    </form>
  );
}
