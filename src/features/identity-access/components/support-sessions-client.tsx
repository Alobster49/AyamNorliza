"use client";

import { useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { openSupportSessionAction, endSupportSessionAction } from "@/features/identity-access/server/actions";
import type { OrganizationMember, SupportSession } from "../types";

const STATUS_KEYS = {
  scheduled: "scheduled",
  active: "active",
  ended: "ended",
  revoked: "revoked",
} as const;

export function SupportSessionsClient(props: {
  organizationId: string;
  sessions: SupportSession[];
  members: OrganizationMember[];
}) {
  const router = useRouter();
  const t = useTranslations("identity.supportSessions");
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>{t("openButton")}</button>
      {error ? <p role="alert">{error}</p> : null}
      {open ? <OpenDialog
        organizationId={props.organizationId}
        members={props.members}
        onClose={() => setOpen(false)}
        onSaved={() => { setOpen(false); router.refresh(); }}
      /> : null}
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr><th>{t("colPurpose")}</th><th>{t("colTechnician")}</th><th>{t("colWindow")}</th><th>{t("colStatus")}</th><th>{t("colActions")}</th></tr>
          </thead>
          <tbody>
            {props.sessions.map((s) => (
              <tr key={s.id}>
                <td>{s.purpose}</td>
                <td><code>{s.technicianId}</code></td>
                <td>
                  {t("window", {
                    start: format.dateTime(new Date(s.startsAt), { dateStyle: "medium", timeStyle: "short" }),
                    end: format.dateTime(new Date(s.endsAt), { dateStyle: "medium", timeStyle: "short" }),
                  })}
                </td>
                <td>{t(`status.${STATUS_KEYS[s.status]}`)}</td>
                <td>
                  {s.status === "active" || s.status === "scheduled" ? (
                    <EndButton sessionId={s.id} onDone={() => router.refresh()} onError={setError} />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EndButton({ sessionId, onDone, onError }: { sessionId: string; onDone: () => void; onError: (m: string) => void }) {
  const t = useTranslations("identity.supportSessions");
  const tRoot = useTranslations();
  return (
    <button
      type="button"
      onClick={async () => {
        const result = await endSupportSessionAction({ sessionId, revokeMembership: true });
        // `messageKey` is a dynamic full path (e.g. "errors.identity.supportSession.alreadyEnded");
        // next-intl's typed `t()` only accepts literal keys, so this is cast at the call site.
        if (!result.ok) onError(tRoot(result.messageKey as never));
        else onDone();
      }}
    >
      {t("end")}
    </button>
  );
}

function OpenDialog({
  organizationId,
  members,
  onClose,
  onSaved,
}: {
  organizationId: string;
  members: OrganizationMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("identity.supportSessions");
  const tRoot = useTranslations();
  const [sponsorId, setSponsorId] = useState(members[0]?.userId ?? "");
  const [technicianId, setTechnicianId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [durationHours, setDurationHours] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);
    const result = await openSupportSessionAction({
      organizationId,
      sponsorId,
      technicianId,
      purpose,
      permittedScopes: [],
      startsAt: now.toISOString(),
      endsAt: endsAt.toISOString(),
    });
    setPending(false);
    if (!result.ok) {
      // `messageKey` is a dynamic full path (e.g. "errors.identity.common.forbidden");
      // next-intl's typed `t()` only accepts literal keys, so this is cast at the call site.
      setError(tRoot(result.messageKey as never));
      return;
    }
    onSaved();
  }

  return (
    <div className="dialog-backdrop">
      <form onSubmit={onSubmit} className="dialog">
        <h2>{t("dialogTitle")}</h2>
        <label>{t("sponsorLabel")}
          <select
            className="w-full min-w-0"
            value={sponsorId}
            onChange={(e) => setSponsorId(e.target.value)}
          >
            {members.map((m) => <option key={m.id} value={m.userId}>{m.userId} ({m.role})</option>)}
          </select>
        </label>
        <label>{t("technicianLabel")}
          <input value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} required />
        </label>
        <label>{t("purposeLabel")}
          <textarea required minLength={5} maxLength={500} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </label>
        <label>{t("durationLabel")}
          <input type="number" min={1} max={24} value={durationHours} onChange={(e) => setDurationHours(Number(e.target.value))} />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <div className="dialog__actions">
          <button type="button" onClick={onClose}>{t("cancel")}</button>
          <button type="submit" disabled={pending}>{pending ? t("opening") : t("open")}</button>
        </div>
      </form>
    </div>
  );
}
