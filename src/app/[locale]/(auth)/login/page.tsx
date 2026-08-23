import Image from "next/image";
import { LoginForm } from "@/components/forms/login-form";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
import { ThemeToggle } from "@/components/shared/theme-toggle";

export const metadata = { title: "Sign in - AyamNorliza" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <main className="grid min-h-svh bg-background lg:grid-cols-2">
      <section className="flex min-h-svh flex-col gap-6 px-6 py-8 md:px-10">
        <div className="flex items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-2 font-medium text-foreground">
            <span className="flex size-7 items-center justify-center rounded-md bg-white">
              <Image
                src="/logo-nb-poultry.webp"
                alt="NB Poultry Processing Industries"
                width={28}
                height={28}
                className="size-full rounded-md object-contain"
              />
            </span>
            AyamNorliza Ops
          </a>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">
            <LoginForm next={next} />
          </div>
        </div>
      </section>
      <section className="relative hidden min-h-svh overflow-hidden bg-muted lg:block">
        <Image
          src="https://images.unsplash.com/photo-1700423240953-06c9629f005c?auto=format&fit=crop&fm=jpg&q=80&w=1800"
          alt="Chickens moving through a shaded poultry yard"
          fill
          priority
          sizes="50vw"
          className="object-cover dark:brightness-[0.35] dark:grayscale"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-background/20 to-transparent" />
      </section>
    </main>
  );
}
