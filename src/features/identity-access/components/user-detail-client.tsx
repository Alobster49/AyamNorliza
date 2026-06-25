"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { changeMemberRoleAction, changeMemberScopeAction, deactivateUserAction } from "@/features/identity-access/server/actions";
import { ROLES } from "@/lib/auth/permissions";
import { ReauthDialog } from "@/components/forms/reauth-dialog";
import type { MemberScope, OrganizationMember } from "../types";

export function UserDetailClient(props: {
  organizationId: string;
  member: OrganizationMember;
  scopes: MemberScope[];
}) {
  const router = useRouter();
  const [role, setRole] = useState(props.member.role);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<null | (() => Promise<{ ok: boolean; message?: string }>)>(null);

  async function reauthThen(retry: () => Promise<{ ok: boolean; message?: string }>) {
    setPendingAction(() => retry);
    setReauthOpen(true);
  }

  async function saveRole() {
    setError(null);
    setPending(true);
    const result = await changeMemberRoleAction({
      memberId: props.member.id,
      newRole: role as (typeof ROLES)[number],
      reason: reason || "Updated via member detail",
    });
    setPending(false);
    if (!result.ok) {
      if (result.code === "reauth_required") {
        await reauthThen(() =>
          changeMemberRoleAction({ memberId: props.member.id, newRole: role as (typeof ROLES)[number], reason: reason || "Updated via member detail" }),
        );
        return;
      }
      setError(result.message);
      return;
    }
    router.refresh();
  }

  async function deactivate() {
    setError(null);
    setPending(true);
    const result = await deactivateUserAction({ memberId: props.member.id, reason: reason || "Deactivated from member detail" });
    setPending(false);
    if (!result.ok) {
      if (result.code === "reauth_required") {
        await reauthThen(() =>
          deactivateUserAction({ memberId: props.member.id, reason: reason || "Deactivated from member detail" }),
        );
        return;
      }
      setError(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <p>User id: <code>{props.member.userId}</code></p>
      <p>Status: {props.member.status}</p>
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
      <label>
        Reason
        <input value={reason} onChange={(e) => setReason(e.target.value)} minLength={10} maxLength={1000} required />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <div className="page-actions">
        <button type="button" disabled={pending} onClick={saveRole}>
          Save role
        </button>
        {props.member.status === "active" ? (
          <button type="button" disabled={pending} onClick={deactivate}>
            Deactivate
          </button>
        ) : null}
      </div>
      <h2>Scopes ({props.scopes.length})</h2>
      <ul>
        {props.scopes.map((s) => (
          <li key={s.id}>
            {s.siteId ? `site ${s.siteId}` : s.zoneId ? `zone ${s.zoneId}` : s.houseId ? `house ${s.houseId}` : "org-wide"}
            {s.permission ? ` - ${s.permission}` : ""}
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
