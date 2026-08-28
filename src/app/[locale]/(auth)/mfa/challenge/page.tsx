import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { getMfaFactorsAction } from "@/features/identity-access/server/auth-actions";
import { MfaChallengeForm } from "@/components/forms/mfa-challenge-form";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
import { toLocaleAgnostic } from "@/lib/auth/next-path";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.mfaChallenge");
  return { title: t("pageTitle") };
}

export default async function MfaChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // Deliberately no `requireAal2` here: this is the page that *resolves* the
  // step-up, so gating it on aal2 would bounce it to itself forever. Being
  // signed in at any level is enough to read one's own factor list and
  // complete a challenge.
  await requireUserOrRedirect("/mfa/challenge");
  const { next } = await searchParams;
  const nextPath = toLocaleAgnostic(next) ?? "/";

  const factors = await getMfaFactorsAction();
  const totp = factors.ok ? factors.data.totp[0] : undefined;
  if (!totp) {
    // Nothing to challenge - e.g. someone navigated here directly without a
    // verified factor (or unenrolled in another tab). Send them on to their
    // destination rather than stranding them on a dead-end form.
    redirect({ href: nextPath, locale: await getLocale() });
    return;
  }

  return (
    <main className="auth-page">
      <div className="flex justify-end">
        <LocaleSwitcher />
      </div>
      <MfaChallengeForm factorId={totp.id} nextPath={nextPath} />
    </main>
  );
}
