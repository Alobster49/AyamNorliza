"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { reauthAction } from "@/features/identity-access/server/auth-actions";

/**
 * Step-up dialog. Sensitive Server Actions return a `reauth_required`
 * error code; the calling island mounts this dialog so the user can
 * re-confirm with password + TOTP, after which the action is retried.
 */
export function ReauthDialog({
  open,
  onClose,
  onSuccess,
  retryAction,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  retryAction: () => Promise<{ ok: boolean; code?: string; message?: string }>;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!open) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await reauthAction({ password, totpCode: totpCode || undefined });
    if (!result.ok) {
      setPending(false);
      setError(result.message);
      return;
    }
    setPending(false);
    onClose();
    onSuccess();
    const retried = await retryAction();
    if (!retried.ok) {
      setError(retried.message ?? "Action failed after re-auth");
    } else {
      router.refresh();
    }
  }

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true">
      <form onSubmit={onSubmit} className="dialog">
        <h2>Confirm it&apos;s you</h2>
        <p>For your security, this action requires recent re-authentication.</p>
        <label>
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          6-digit code (if MFA enabled)
          <input
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value)}
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <div className="dialog__actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={pending || !password}>
            {pending ? "Verifying..." : "Confirm"}
          </button>
        </div>
      </form>
    </div>
  );
}
