import { LoginForm } from "@/components/forms/login-form";

export const metadata = { title: "Sign in - AyamNorliza" };

export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  return (
    <main className="auth-page">
      <LoginForm next={searchParams.next} />
    </main>
  );
}
