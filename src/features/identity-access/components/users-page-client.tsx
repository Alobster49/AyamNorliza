"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { InviteUserDialog } from "@/components/forms/invite-user-dialog";
import {
  resendInvitationAction,
  revokeInvitationAction,
  changeMemberRoleAction,
  deactivateUserAction,
} from "@/features/identity-access/server/actions";
import { ROLES } from "@/lib/auth/permissions";
import { roleLabelKey } from "@/features/access-control/components/role-label";
import type { Invitation, MemberScope, OrganizationMember } from "../types";
import { ReauthDialog } from "@/components/forms/reauth-dialog";

export function UsersPageClient(props: {
  organizationId: string;
  organizationSlug: string;
  members: OrganizationMember[];
  invitations: Invitation[];
  scopes: MemberScope[];
}) {
  const router = useRouter();
  const t = useTranslations("identity.usersPage");
  const tRoles = useTranslations("roles");
  const tStatus = useTranslations("identity.memberStatus");
  const tInvitationStatus = useTranslations("identity.invitationStatus");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<null | (() => Promise<{ ok: boolean; code?: string; message?: string }>)>(null);
  const [error, setError] = useState<string | null>(null);

  async function reauthThen(retry: () => Promise<{ ok: boolean; code?: string; message?: string }>) {
    setPendingAction(() => retry);
    setReauthOpen(true);
  }

  async function changeRole(memberId: string, newRole: string) {
    setError(null);
    const result = await changeMemberRoleAction({
      memberId,
      newRole: newRole as (typeof ROLES)[number],
      reason: t("defaultRoleChangeReason"),
    });
    if (!result.ok) {
      if (result.code === "reauth_required") {
        await reauthThen(() =>
          changeMemberRoleAction({ memberId, newRole: newRole as (typeof ROLES)[number], reason: t("defaultRoleChangeReason") }),
        );
        return;
      }
      setError(result.message);
      return;
    }
    router.refresh();
  }

  async function deactivate(memberId: string) {
    setError(null);
    const result = await deactivateUserAction({ memberId, reason: t("defaultDeactivateReason") });
    if (!result.ok) {
      if (result.code === "reauth_required") {
        await reauthThen(() => deactivateUserAction({ memberId, reason: t("defaultDeactivateReason") }));
        return;
      }
      setError(result.message);
      return;
    }
    router.refresh();
  }

  async function resend(invitationId: string) {
    const result = await resendInvitationAction({ invitationId });
    if (!result.ok) setError(result.message);
  }

  async function revoke(invitationId: string) {
    const result = await revokeInvitationAction({ invitationId });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <div className="page-actions">
        <button type="button" onClick={() => setInviteOpen(true)}>
          {t("inviteUser")}
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}

      <h2>{t("membersHeading", { count: props.members.length })}</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>{t("colUser")}</th>
            <th>{t("colRole")}</th>
            <th>{t("colStatus")}</th>
            <th>{t("colScopes")}</th>
            <th>{t("colActions")}</th>
          </tr>
        </thead>
        <tbody>
          {props.members.map((m) => (
            <tr key={m.id}>
              <td><code>{m.userId}</code></td>
              <td>
                <select defaultValue={m.role} onChange={(e) => changeRole(m.id, e.target.value)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {tRoles(roleLabelKey(r))}
                    </option>
                  ))}
                </select>
              </td>
              <td>{tStatus(m.status)}</td>
              <td>
                {props.scopes.filter((s) => s.organizationMemberId === m.id).length}
              </td>
              <td>
                {m.status === "active" ? (
                  <button type="button" onClick={() => deactivate(m.id)}>
                    {t("deactivate")}
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>{t("invitationsHeading", { count: props.invitations.length })}</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>{t("colEmail")}</th>
            <th>{t("colRole")}</th>
            <th>{t("colStatus")}</th>
            <th>{t("colActions")}</th>
          </tr>
        </thead>
        <tbody>
          {props.invitations.map((inv) => (
            <tr key={inv.id}>
              <td>{inv.email}</td>
              <td>{tRoles(roleLabelKey(inv.role))}</td>
              <td>
                {inv.acceptedAt
                  ? tInvitationStatus("accepted")
                  : inv.revokedAt
                    ? tInvitationStatus("revoked")
                    : new Date(inv.expiresAt) < new Date()
                      ? tInvitationStatus("expired")
                      : tInvitationStatus("pending")}
              </td>
              <td>
                {!inv.acceptedAt && !inv.revokedAt ? (
                  <>
                    <button type="button" onClick={() => resend(inv.id)}>{t("resend")}</button>
                    <button type="button" onClick={() => revoke(inv.id)}>{t("revoke")}</button>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <InviteUserDialog
        organizationId={props.organizationId}
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
      />
      <ReauthDialog
        open={reauthOpen}
        onClose={() => setReauthOpen(false)}
        onSuccess={() => {
          setReauthOpen(false);
        }}
        retryAction={async () => {
          if (!pendingAction) return { ok: true };
          return pendingAction();
        }}
      />
    </div>
  );
}
