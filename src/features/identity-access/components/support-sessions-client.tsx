"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { openSupportSessionAction, endSupportSessionAction } from "@/features/identity-access/server/actions";
import type { OrganizationMember, SupportSession } from "../types";

export function SupportSessionsClient(props: {
  organizationId: string;
  sessions: SupportSession[];
  members: OrganizationMember[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Open support session</button>
      {error ? <p role="alert">{error}</p> : null}
      {open ? <OpenDialog
        organizationId={props.organizationId}
        members={props.members}
        onClose={() => setOpen(false)}
        onSaved={() => { setOpen(false); router.refresh(); }}
      /> : null}
      <table className="data-table">
        <thead>
          <tr><th>Purpose</th><th>Technician</th><th>Window</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {props.sessions.map((s) => (
            <tr key={s.id}>
              <td>{s.purpose}</td>
              <td><code>{s.technicianId}</code></td>
              <td>{new Date(s.startsAt).toLocaleString()} → {new Date(s.endsAt).toLocaleString()}</td>
              <td>{s.status}</td>
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
  );
}

function EndButton({ sessionId, onDone, onError }: { sessionId: string; onDone: () => void; onError: (m: string) => void }) {
  return (
    <button
      type="button"
      onClick={async () => {
        const result = await endSupportSessionAction({ sessionId, revokeMembership: true });
        if (!result.ok) onError(result.message);
        else onDone();
      }}
    >
      End
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
      setError(result.message);
      return;
    }
    onSaved();
  }

  return (
    <div className="dialog-backdrop">
      <form onSubmit={onSubmit} className="dialog">
        <h2>Open support session</h2>
        <label>Sponsor
          <select value={sponsorId} onChange={(e) => setSponsorId(e.target.value)}>
            {members.map((m) => <option key={m.id} value={m.userId}>{m.userId} ({m.role})</option>)}
          </select>
        </label>
        <label>Technician user id
          <input value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} required />
        </label>
        <label>Purpose
          <textarea required minLength={5} maxLength={500} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </label>
        <label>Duration (hours, max 24)
          <input type="number" min={1} max={24} value={durationHours} onChange={(e) => setDurationHours(Number(e.target.value))} />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <div className="dialog__actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={pending}>{pending ? "Opening..." : "Open"}</button>
        </div>
      </form>
    </div>
  );
}
