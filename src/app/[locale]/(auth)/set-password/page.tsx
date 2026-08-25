import { getTranslations } from "next-intl/server";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { SetPasswordForm } from "@/components/forms/set-password-form";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";

export default async function SetPasswordPage() {
  // Recovery-link flow: the auth callback has already exchanged the code
  // for a session, so an unauthenticated visitor has no business here.
  await requireUserOrRedirect();
  const t = await getTranslations("auth.setPassword");
  return (
    <main className="auth-page">
      <div className="flex justify-end">
        <LocaleSwitcher />
      </div>
      <section>
        <h1>{t("title")}</h1>
        <SetPasswordForm />
      </section>
    </main>
  );
}
