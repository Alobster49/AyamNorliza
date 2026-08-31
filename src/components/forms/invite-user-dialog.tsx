"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { resolveMessageKey } from "@/lib/i18n/resolve-message-key";
import { inviteUserAction } from "@/features/identity-access/server/actions";
import { roleDisplayLabel } from "@/features/access-control/components/role-label";
import type { OrganizationRole } from "@/features/identity-access/types";

export function InviteUserDialog({
  organizationId,
  roles,
  open,
  onClose,
}: {
  organizationId: string;
  /** Org roles the current actor may grant (already filtered to
   * `rank <= actor's rank` by the server page), rendered instead of the
   * hardcoded `ROLES` list so a custom role shows up without a code change. */
  roles: OrganizationRole[];
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const t = useTranslations("identity.inviteUserDialog");
  const tRoot = useTranslations();
  const tRoles = useTranslations("roles");
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState<string>(roles[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!open) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await inviteUserAction({ organizationId, email, roleId, scopes: [] });
    setPending(false);
    if (!result.ok) {
      // `messageKey` is a dynamic full path (e.g. "errors.identity.roles.cannotGrantRole");
      // next-intl's typed `t()` only accepts literal keys, so this is cast at the call site.
      setError(resolveMessageKey(tRoot, result.messageKey!, result.messageParams));
      return;
    }
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
