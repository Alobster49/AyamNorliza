"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { resolveMessageKey } from "@/lib/i18n/resolve-message-key";
import { createUserAction, type ActionResult } from "@/features/identity-access/server/actions";
import { roleDisplayLabel } from "@/features/access-control/components/role-label";
import type { OrganizationRole } from "@/features/identity-access/types";

export function CreateUserDialog({
  organizationId,
  roles,
  open,
  onClose,
  onReauthNeeded,
}: {
  organizationId: string;
  /** Org roles the current actor may grant (already filtered to
   * `rank <= actor's rank` by the server page). */
  roles: OrganizationRole[];
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
  const [roleId, setRoleId] = useState<string>(roles[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!open) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const payload = { organizationId, email, displayName, roleId };
    const result = await createUserAction(payload);
    setPending(false);
    if (!result.ok) {
      if (result.code === "reauth_required") {
        onReauthNeeded(() => createUserAction(payload));
        setDisplayName("");
        setEmail("");
        setRoleId(roles[0]?.id ?? "");
        onClose();
        return;
      }
      setError(resolveMessageKey(tRoot, result.messageKey!, result.messageParams));
      return;
    }
    setDisplayName("");
    setEmail("");
    setRoleId(roles[0]?.id ?? "");
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
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {roleDisplayLabel(tRoles, r)}
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
