"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateOrganizationSettingsAction } from "@/features/identity-access/server/actions";

export function UpdateOrganizationForm(props: {
  organizationId: string;
  name: string;
  legalName: string | null;
  region: string | null;
  defaultTimeZone: string;
  defaultLocale: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(props.name);
  const [legalName, setLegalName] = useState(props.legalName ?? "");
  const [region, setRegion] = useState(props.region ?? "");
  const [tz, setTz] = useState(props.defaultTimeZone);
  const [locale, setLocale] = useState(props.defaultLocale);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await updateOrganizationSettingsAction({
      organizationId: props.organizationId,
      name,
      legalName: legalName || null,
      region: region || null,
      defaultTimeZone: tz,
      defaultLocale: locale,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="settings-form">
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={150} />
      </label>
      <label>
        Legal name
        <input value={legalName} onChange={(e) => setLegalName(e.target.value)} maxLength={200} />
      </label>
      <label>
        Region
        <input value={region} onChange={(e) => setRegion(e.target.value)} maxLength={50} />
      </label>
      <label>
        Default time zone
        <input value={tz} onChange={(e) => setTz(e.target.value)} required />
      </label>
      <label>
        Default locale
        <input value={locale} onChange={(e) => setLocale(e.target.value)} required minLength={2} maxLength={10} />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save changes"}
      </button>
    </form>
  );
}
