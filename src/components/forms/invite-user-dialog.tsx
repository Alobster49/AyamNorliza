"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inviteUserAction } from "@/features/identity-access/server/actions";
import { ROLES } from "@/lib/auth/permissions";

export function InviteUserDialog({
  organizationId,
  open,
  onClose,
}: {
  organizationId: string;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("caretaker");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!open) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await inviteUserAction({ organizationId, email, role, scopes: [] });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setEmail("");
    setRole("caretaker");
    onClose();
    router.refresh();
  }

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true">
      <form onSubmit={onSubmit} className="dialog">
        <h2>Invite a user</h2>
        <label>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <div className="dialog__actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={pending || !email}>
            {pending ? "Sending..." : "Send invite"}
          </button>
        </div>
      </form>
    </div>
  );
}
