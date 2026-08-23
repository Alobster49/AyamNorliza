import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { MfaEnrollCard } from "@/components/forms/mfa-enroll-card";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
import { sanitizeNextPath } from "@/lib/auth/next-path";

export const metadata = { title: "Two-factor authentication - AyamNorliza" };

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
      <MfaEnrollCard isOptional nextPath={sanitizeNextPath(next) ?? "/"} />
    </main>
  );
}
