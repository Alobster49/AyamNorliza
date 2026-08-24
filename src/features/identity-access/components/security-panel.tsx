"use client";

import { useTranslations } from "next-intl";

import { MfaStatusCard } from "@/components/forms/mfa-enroll-card";

interface MfaFactor {
  id: string;
  friendly_name: string | null;
  created_at: string;
}

export function SecurityPanel({ userId: _userId, email, displayName, mfaFactors }: {
  userId: string;
  email: string;
  displayName: string;
  mfaFactors: MfaFactor[];
}) {
  const t = useTranslations("identity.securityPanel");
  return (
    <div>
      <p>{t("signedInAs", { name: displayName || email })}</p>
      <MfaStatusCard factors={mfaFactors} />
    </div>
  );
}
