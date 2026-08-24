import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SignupForm } from "@/components/forms/signup-form";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.signup");
  return { title: t("pageTitle") };
}

export default function SignupPage() {
  return (
    <main className="auth-page">
      <div className="flex justify-end">
        <LocaleSwitcher />
      </div>
      <SignupForm />
    </main>
  );
}
