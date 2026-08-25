"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { resolveMessageKey } from "@/lib/i18n/resolve-message-key";
import { InviteUserDialog } from "@/components/forms/invite-user-dialog";
import { EditMemberDialog } from "@/components/forms/edit-member-dialog";
import { CreateUserDialog } from "@/components/forms/create-user-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  resendInvitationAction,
  revokeInvitationAction,
  changeMemberRoleAction,
  deactivateUserAction,
  sendPasswordResetAction,
  removeMemberAction,
  type ActionResult,
} from "@/features/identity-access/server/actions";
import { ROLES } from "@/lib/auth/permissions";
import { roleLabelKey } from "@/features/access-control/components/role-label";
import type { Invitation, MemberScope } from "../types";
import type { MemberDirectoryRow } from "../directory";
import { ReauthDialog } from "@/components/forms/reauth-dialog";

export function UsersPageClient(props: {
  organizationId: string;
  organizationSlug: string;
  members: MemberDirectoryRow[];
  invitations: Invitation[];
  scopes: MemberScope[];
}) {
  const router = useRouter();
  const t = useTranslations("identity.usersPage");
  const tRoot = useTranslations();
  const tRoles = useTranslations("roles");
  const tStatus = useTranslations("identity.memberStatus");
  const tInvitationStatus = useTranslations("identity.invitationStatus");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<MemberDirectoryRow | null>(null);
  const [resetTarget, setResetTarget] = useState<MemberDirectoryRow | null>(null);
  const [removeTarget, setRemoveTarget] = useState<MemberDirectoryRow | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<null | (() => Promise<ActionResult<unknown>>)>(null);
  const [error, setError] = useState<string | null>(null);

  async function reauthThen(retry: () => Promise<ActionResult<unknown>>) {
    setPendingAction(() => retry);
    setReauthOpen(true);
  }

  // `messageKey` is a dynamic full path (e.g. "errors.identity.member.notFound");
  // next-intl's typed `t()` only accepts literal keys, so this is cast at the call site.
  function showError(result: { messageKey?: string; messageParams?: Record<string, string | number> }) {
    setError(resolveMessageKey(tRoot, result.messageKey!, result.messageParams));
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
      showError(result);
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
      showError(result);
      return;
    }
    router.refresh();
  }

  async function sendReset(member: MemberDirectoryRow) {
    setError(null);
    const result = await sendPasswordResetAction({ memberId: member.id });
    if (!result.ok) showError(result);
  }

  async function removeMember(member: MemberDirectoryRow) {
    setError(null);
    const result = await removeMemberAction({ memberId: member.id, reason: t("defaultRemoveReason") });
    if (!result.ok) {
      if (result.code === "reauth_required") {
        await reauthThen(() => removeMemberAction({ memberId: member.id, reason: t("defaultRemoveReason") }));
        return;
      }
      showError(result);
      return;
    }
    router.refresh();
  }

  async function resend(invitationId: string) {
    const result = await resendInvitationAction({ invitationId });
    if (!result.ok) showError(result);
  }

  async function revoke(invitationId: string) {
    const result = await revokeInvitationAction({ invitationId });
    if (!result.ok) {
      showError(result);
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
        <button type="button" onClick={() => setCreateOpen(true)}>
          {t("createUser")}
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
              <td>
                <div title={m.userId}>
                  <strong>{m.displayName ?? t("unknownUser")}</strong>
                  <br />
                  <span className="text-muted-foreground">{m.email ?? "—"}</span>
                </div>
              </td>
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
                <button type="button" onClick={() => setEditing(m)}>{t("editDetails")}</button>
                <button type="button" onClick={() => setResetTarget(m)}>{t("resetPassword")}</button>
                {m.status === "active" ? (
                  <button type="button" onClick={() => deactivate(m.id)}>
                    {t("deactivate")}
                  </button>
                ) : null}
                <button type="button" onClick={() => setRemoveTarget(m)}>{t("removeMember")}</button>
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
      <CreateUserDialog
        organizationId={props.organizationId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onReauthNeeded={(retry) => reauthThen(retry)}
      />
      <EditMemberDialog
        member={editing}
        onClose={() => setEditing(null)}
        onReauthNeeded={(retry) => reauthThen(retry)}
      />
      <ConfirmDialog
        open={resetTarget !== null}
        onOpenChange={(open) => !open && setResetTarget(null)}
        title={t("confirmResetTitle")}
        description={t("confirmResetDescription", { email: resetTarget?.email ?? "" })}
        confirmLabel={t("resetPassword")}
        onConfirm={async () => {
          if (resetTarget) await sendReset(resetTarget);
        }}
      />
      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={t("confirmRemoveTitle")}
        description={t("confirmRemoveDescription", {
          name: removeTarget?.displayName ?? removeTarget?.email ?? "",
        })}
        confirmLabel={t("removeMember")}
        onConfirm={async () => {
          if (removeTarget) await removeMember(removeTarget);
        }}
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
