"use client";

import { useState } from "react";
import { signUpAction } from "@/features/identity-access/server/auth-actions";

export function SignupForm() {
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
        <h1>Check your email</h1>
        <p>We sent a confirmation link to {email}. Click it to finish setting up your account.</p>
      </section>
    );
  }

  return (
    <form onSubmit={onSubmit} className="auth-form">
      <h1>Create account</h1>
      <p>New accounts are invite-only. Contact your organization owner if you need access.</p>
      <label>
        Email
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label>
        Display name
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
        Password (min 12)
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
        {pending ? "Creating..." : "Create account"}
      </button>
    </form>
  );
}
