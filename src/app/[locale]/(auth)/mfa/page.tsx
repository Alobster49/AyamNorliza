import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { MfaEnrollCard } from "@/components/forms/mfa-enroll-card";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
import { toLocaleAgnostic } from "@/lib/auth/next-path";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.mfa");
  return { title: t("pageTitle") };
}

export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  await requireUserOrRedirect("/mfa");
  const { next } = await searchParams;
  return (
    <main className="auth-page">
      <div className="flex justify-end">
        <LocaleSwitcher />
      </div>
      <MfaEnrollCard isOptional nextPath={toLocaleAgnostic(next) ?? "/"} />
    </main>
  );
}
