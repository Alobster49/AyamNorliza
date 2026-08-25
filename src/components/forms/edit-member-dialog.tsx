"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { resolveMessageKey } from "@/lib/i18n/resolve-message-key";
import { updateMemberProfileAction, type ActionResult } from "@/features/identity-access/server/actions";
import type { MemberDirectoryRow } from "@/features/identity-access/directory";

export function EditMemberDialog({
  member,
  onClose,
  onReauthNeeded,
}: {
  member: MemberDirectoryRow | null;
  onClose: () => void;
  /** Parent owns the ReauthDialog; retry re-invokes with the same values. */
  onReauthNeeded: (retry: () => Promise<ActionResult<unknown>>) => void;
}) {
  const router = useRouter();
  const t = useTranslations("identity.editMemberDialog");
  const tRoot = useTranslations();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing form fields to the member prop, matches board-dialogs.tsx idiom
    setDisplayName(member?.displayName ?? "");
    setEmail(member?.email ?? "");
    setError(null);
  }, [member]);

  if (!member) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!member) return;
    setError(null);
    setPending(true);
    const payload = {
      memberId: member.id,
      ...(displayName !== (member.displayName ?? "") ? { displayName } : {}),
      ...(email !== (member.email ?? "") ? { email } : {}),
      reason: t("defaultReason"),
    };
    const result = await updateMemberProfileAction(payload);
    setPending(false);
    if (!result.ok) {
      if (result.code === "reauth_required") {
        onReauthNeeded(() => updateMemberProfileAction(payload));
        onClose();
        return;
      }
      setError(resolveMessageKey(tRoot, result.messageKey!, result.messageParams));
      return;
    }
    onClose();
    router.refresh();
  }

  const dirty = displayName !== (member.displayName ?? "") || email !== (member.email ?? "");

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
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <div className="dialog__actions">
          <button type="button" onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="submit" disabled={pending || !dirty}>
            {pending ? t("saving") : t("save")}
          </button>
        </div>
      </form>
    </div>
  );
}
