import { SignupForm } from "@/components/forms/signup-form";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";

export const metadata = { title: "Sign up - AyamNorliza" };

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
