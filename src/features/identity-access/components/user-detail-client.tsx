"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { resolveMessageKey } from "@/lib/i18n/resolve-message-key";
import { changeMemberRoleAction, changeMemberScopeAction, deactivateUserAction } from "@/features/identity-access/server/actions";
import { roleDisplayLabel } from "@/features/access-control/components/role-label";
import { ReauthDialog } from "@/components/forms/reauth-dialog";
import type { MemberScope, OrganizationMember, OrganizationRole } from "../types";

const MEMBER_STATUS_KEYS = {
  invited: "invited",
  active: "active",
  suspended: "suspended",
  expired: "expired",
} as const;

export function UserDetailClient(props: {
  organizationId: string;
  member: OrganizationMember;
  scopes: MemberScope[];
  /** Org roles the current actor may grant (already filtered to
   * `rank <= actor's rank` by the server page). */
  roles: OrganizationRole[];
}) {
  const router = useRouter();
  const t = useTranslations("identity.userDetail");
  const tRoot = useTranslations();
  const tRoles = useTranslations("roles");
  const tStatus = useTranslations("identity.memberStatus");
  const [roleId, setRoleId] = useState(props.member.roleId);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<null | (() => Promise<{
    ok: boolean;
    message?: string;
    messageKey?: string;
    messageParams?: Record<string, string | number>;
  }>)>(null);

  async function reauthThen(
    retry: () => Promise<{ ok: boolean; message?: string; messageKey?: string; messageParams?: Record<string, string | number> }>,
  ) {
    setPendingAction(() => retry);
    setReauthOpen(true);
  }

  async function saveRole() {
    setError(null);
    setPending(true);
    const result = await changeMemberRoleAction({
      memberId: props.member.id,
      newRoleId: roleId,
      reason: reason || t("defaultReason"),
    });
    setPending(false);
    if (!result.ok) {
      if (result.code === "reauth_required") {
        await reauthThen(() =>
          changeMemberRoleAction({ memberId: props.member.id, newRoleId: roleId, reason: reason || t("defaultReason") }),
        );
        return;
      }
      // `messageKey` is a dynamic full path (e.g. "errors.identity.member.notFound");
      // next-intl's typed `t()` only accepts literal keys, so this is cast at the call site.
      setError(resolveMessageKey(tRoot, result.messageKey!, result.messageParams));
      return;
    }
    router.refresh();
  }

  async function deactivate() {
    setError(null);
    setPending(true);
    const result = await deactivateUserAction({ memberId: props.member.id, reason: reason || t("defaultDeactivateReason") });
    setPending(false);
    if (!result.ok) {
      if (result.code === "reauth_required") {
        await reauthThen(() =>
          deactivateUserAction({ memberId: props.member.id, reason: reason || t("defaultDeactivateReason") }),
        );
        return;
      }
      setError(resolveMessageKey(tRoot, result.messageKey!, result.messageParams));
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <p>{t("userIdLabel")} <code className="break-all">{props.member.userId}</code></p>
      <p>{t("statusLabel")} {tStatus(MEMBER_STATUS_KEYS[props.member.status])}</p>
      <div className="settings-form">
        <label>
          {t("roleLabel")}
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {props.roles.map((r) => (
              <option key={r.id} value={r.id}>
                {roleDisplayLabel(tRoles, r)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("reasonLabel")}
          <input value={reason} onChange={(e) => setReason(e.target.value)} minLength={10} maxLength={1000} required />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <div className="page-actions">
          <button type="button" disabled={pending} onClick={saveRole}>
            {t("saveRole")}
          </button>
          {props.member.status === "active" ? (
            <button type="button" disabled={pending} onClick={deactivate}>
              {t("deactivate")}
            </button>
          ) : null}
        </div>
      </div>
      <h2>{t("scopesHeading", { count: props.scopes.length })}</h2>
      <ul>
        {props.scopes.map((s) => (
          <li key={s.id}>
            {s.siteId
              ? t("scopeSite", { id: s.siteId })
              : s.zoneId
                ? t("scopeZone", { id: s.zoneId })
                : s.houseId
                  ? t("scopeHouse", { id: s.houseId })
                  : t("scopeOrgWide")}
            {s.permission ? t("scopePermissionSuffix", { permission: s.permission }) : ""}
          </li>
        ))}
      </ul>
      <ReauthDialog
        open={reauthOpen}
        onClose={() => setReauthOpen(false)}
        onSuccess={() => setReauthOpen(false)}
        retryAction={async () => {
          if (!pendingAction) return { ok: true };
          return pendingAction();
        }}
      />
    </div>
  );
}
