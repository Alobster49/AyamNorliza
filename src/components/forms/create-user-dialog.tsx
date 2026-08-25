"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { resolveMessageKey } from "@/lib/i18n/resolve-message-key";
import { createUserAction, type ActionResult } from "@/features/identity-access/server/actions";
import { ROLES } from "@/lib/auth/permissions";
import { roleLabelKey } from "@/features/access-control/components/role-label";

export function CreateUserDialog({
  organizationId,
  open,
  onClose,
  onReauthNeeded,
}: {
  organizationId: string;
  open: boolean;
  onClose: () => void;
  onReauthNeeded: (retry: () => Promise<ActionResult<unknown>>) => void;
}) {
  const router = useRouter();
  const t = useTranslations("identity.createUserDialog");
  const tRoot = useTranslations();
  const tRoles = useTranslations("roles");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("caretaker");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!open) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const payload = { organizationId, email, displayName, role };
    const result = await createUserAction(payload);
    setPending(false);
    if (!result.ok) {
      if (result.code === "reauth_required") {
        onReauthNeeded(() => createUserAction(payload));
        return;
      }
      setError(resolveMessageKey(tRoot, result.messageKey!, result.messageParams));
      return;
    }
    setDisplayName("");
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
          {t("nameLabel")}
          <input
            type="text"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
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
        <p>{t("setPasswordNote")}</p>
        {error ? <p role="alert">{error}</p> : null}
        <div className="dialog__actions">
          <button type="button" onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="submit" disabled={pending || !email || !displayName}>
            {pending ? t("creating") : t("create")}
          </button>
        </div>
      </form>
    </div>
  );
}
