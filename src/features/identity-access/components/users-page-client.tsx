"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { InviteUserDialog } from "@/components/forms/invite-user-dialog";
import {
  resendInvitationAction,
  revokeInvitationAction,
  changeMemberRoleAction,
  deactivateUserAction,
} from "@/features/identity-access/server/actions";
import { ROLES } from "@/lib/auth/permissions";
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
      reason: `Role change via users page`,
    });
    if (!result.ok) {
      if (result.code === "reauth_required") {
        await reauthThen(() =>
          changeMemberRoleAction({ memberId, newRole: newRole as (typeof ROLES)[number], reason: "Role change via users page" }),
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
    const result = await deactivateUserAction({ memberId, reason: "Deactivated from users page" });
    if (!result.ok) {
      if (result.code === "reauth_required") {
        await reauthThen(() => deactivateUserAction({ memberId, reason: "Deactivated from users page" }));
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
          Invite user
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}

      <h2>Members ({props.members.length})</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Role</th>
            <th>Status</th>
            <th>Scopes</th>
            <th>Actions</th>
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
                      {r}
                    </option>
                  ))}
                </select>
              </td>
              <td>{m.status}</td>
              <td>
                {props.scopes.filter((s) => s.organizationMemberId === m.id).length}
              </td>
              <td>
                {m.status === "active" ? (
                  <button type="button" onClick={() => deactivate(m.id)}>
                    Deactivate
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Invitations ({props.invitations.length})</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {props.invitations.map((inv) => (
            <tr key={inv.id}>
              <td>{inv.email}</td>
              <td>{inv.role}</td>
              <td>
                {inv.acceptedAt
                  ? "accepted"
                  : inv.revokedAt
                    ? "revoked"
                    : new Date(inv.expiresAt) < new Date()
                      ? "expired"
                      : "pending"}
              </td>
              <td>
                {!inv.acceptedAt && !inv.revokedAt ? (
                  <>
                    <button type="button" onClick={() => resend(inv.id)}>Resend</button>
                    <button type="button" onClick={() => revoke(inv.id)}>Revoke</button>
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
