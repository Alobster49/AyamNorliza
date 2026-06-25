"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
      setError(result.code === "reauth_required" ? "Please re-authenticate first" : result.message);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true">
      <form onSubmit={onSubmit} className="dialog">
        <h2>Open break-glass access</h2>
        <p>This grants you short-window elevated access. Owners are notified within 60 seconds.</p>
        <label>
          Reason (10-500 chars)
          <textarea required minLength={10} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <label>
          Ticket reference (optional)
          <input type="text" maxLength={100} value={ticket} onChange={(e) => setTicket(e.target.value)} />
        </label>
        <label>
          Duration (minutes, max 60)
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
            Cancel
          </button>
          <button type="submit" disabled={pending || reason.length < 10}>
            {pending ? "Opening..." : "Open"}
          </button>
        </div>
      </form>
    </div>
  );
}
