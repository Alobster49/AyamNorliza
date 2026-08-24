"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { BreakGlassDialogInput } from "@/features/identity-access/components/break-glass-dialog";

/**
 * Open a break-glass event. The dialog collects the reason and an
 * optional ticket reference, then calls the Server Action. Sensitive
 * action: requireReauth() runs on the server first.
 */
export function BreakGlassDialog({
  organizationId,
  open,
  onClose,
}: BreakGlassDialogInput) {
  const router = useRouter();
  const t = useTranslations("identity.breakGlassDialog");
  const [reason, setReason] = useState("");
  const [ticket, setTicket] = useState("");
  const [duration, setDuration] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!open) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const { openBreakGlassAction } = await import("@/features/identity-access/server/actions");
    const result = await openBreakGlassAction({
      organizationId,
      reason,
      ticketReference: ticket || null,
      durationMinutes: duration,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.code === "reauth_required" ? t("reauthRequired") : result.message);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true">
      <form onSubmit={onSubmit} className="dialog">
        <h2>{t("title")}</h2>
        <p>{t("description")}</p>
        <label>
          {t("reasonLabel")}
          <textarea required minLength={10} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <label>
          {t("ticketLabel")}
          <input type="text" maxLength={100} value={ticket} onChange={(e) => setTicket(e.target.value)} />
        </label>
        <label>
          {t("durationLabel")}
          <input
            type="number"
            min={1}
            max={60}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <div className="dialog__actions">
          <button type="button" onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="submit" disabled={pending || reason.length < 10}>
            {pending ? t("opening") : t("open")}
          </button>
        </div>
      </form>
    </div>
  );
}
