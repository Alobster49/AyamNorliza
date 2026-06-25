"use client";

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
  return (
    <div>
      <p>Signed in as <strong>{displayName || email}</strong></p>
      <MfaStatusCard factors={mfaFactors} />
    </div>
  );
}
