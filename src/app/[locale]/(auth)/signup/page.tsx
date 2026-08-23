import { SignupForm } from "@/components/forms/signup-form";

export const metadata = { title: "Sign up - AyamNorliza" };

export default function SignupPage() {
  return (
    <main className="auth-page">
      <SignupForm />
    </main>
  );
}
