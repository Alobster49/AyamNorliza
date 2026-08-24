"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { inviteUserAction } from "@/features/identity-access/server/actions";
import { ROLES } from "@/lib/auth/permissions";
import { roleLabelKey } from "@/features/access-control/components/role-label";

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
  const t = useTranslations("identity.inviteUserDialog");
  const tRoles = useTranslations("roles");
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
        <h2>{t("title")}</h2>
        <label>
          {t("emailLabel")}
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          {t("roleLabel")}
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {tRoles(roleLabelKey(r))}
              </option>
            ))}
          </select>
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <div className="dialog__actions">
          <button type="button" onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="submit" disabled={pending || !email}>
            {pending ? t("sending") : t("sendInvite")}
          </button>
        </div>
      </form>
    </div>
  );
}
