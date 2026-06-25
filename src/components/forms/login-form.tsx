"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { loginAction } from "@/features/identity-access/server/auth-actions";

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
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
    <form onSubmit={onSubmit} className="auth-form">
      <h1>Sign in</h1>
      <label>
        Email
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          minLength={1}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error ? <p role="alert" className="auth-form__error">{error}</p> : null}
      <button type="submit" disabled={pending} className="auth-form__submit">
        {pending ? "Signing in..." : "Sign in"}
      </button>
      <p className="auth-form__hint">
        Tip: enable two-factor authentication in your{" "}
        <a href="/profile/security">security settings</a> for extra protection.
      </p>
    </form>
  );
}
