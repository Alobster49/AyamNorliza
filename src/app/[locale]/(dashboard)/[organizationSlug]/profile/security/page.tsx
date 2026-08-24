import { getTranslations } from "next-intl/server";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { getProfile } from "@/features/identity-access/server/queries";
import { getMfaFactorsAction } from "@/features/identity-access/server/auth-actions";
import { SecurityPanel } from "@/features/identity-access/components/security-panel";

export default async function ProfileSecurityPage() {
  const user = await requireUserOrRedirect();
  const profile = await getProfile(user.id);
  const factorsResult = await getMfaFactorsAction();
  const mfaFactors = factorsResult.ok
    ? factorsResult.data.totp
    : [];
  const t = await getTranslations("settings.security");
  return (
    <section>
      <h1>{t("title")}</h1>
      <SecurityPanel
        userId={user.id}
        email={user.email ?? ""}
        displayName={profile?.displayName ?? user.user_metadata?.display_name ?? user.email ?? ""}
        mfaFactors={mfaFactors}
      />
    </section>
  );
}
