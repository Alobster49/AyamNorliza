import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { MfaEnrollCard } from "@/components/forms/mfa-enroll-card";

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
      <MfaEnrollCard isOptional nextPath={next ?? "/"} />
    </main>
  );
}
