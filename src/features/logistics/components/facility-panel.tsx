"use client";

import { useState, useTransition } from "react";
import type { Facility } from "../types";
import { updateFacility } from "../server/facility-actions";

export function FacilityPanel({
  organizationSlug,
  facility,
  canEdit,
  onSaved,
}: {
  organizationSlug: string;
  facility: Facility | null;
  canEdit: boolean;
  onSaved: (facility: Facility) => void;
}) {
  const [form, setForm] = useState({
    name: facility?.name ?? "",
    addressLine: facility?.address_line ?? "",
    postcode: facility?.postcode ?? "",
    state: facility?.state ?? "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!facility) {
    return <p className="text-sm text-muted-foreground">No facility configured yet.</p>;
  }

  const save = () => {
    startTransition(async () => {
      const result = await updateFacility(organizationSlug, facility.id, form);
      setMessage(result.ok ? "Saved." : result.message);
      if (result.ok) {
        onSaved(result.data);
      }
    });
  };

  const field = (label: string, key: keyof typeof form) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <input
        value={form[key]}
        disabled={!canEdit}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className="rounded border px-2 py-1 disabled:bg-muted"
      />
    </label>
  );

  return (
    <div className="flex max-w-lg flex-col gap-3">
      {!canEdit ? (
        <p className="text-xs text-muted-foreground">
          Only owners and admins can edit the factory location.
        </p>
      ) : null}
      {field("Name", "name")}
      {field("Address", "addressLine")}
      <div className="grid grid-cols-2 gap-3">
        {field("Postcode", "postcode")}
        {field("State", "state")}
      </div>
      {canEdit ? (
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="self-start rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
        >
          Save factory
        </button>
      ) : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
    </div>
  );
}
