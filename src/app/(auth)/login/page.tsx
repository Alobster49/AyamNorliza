import Image from "next/image";
import { GalleryVerticalEnd } from "lucide-react";
import { LoginForm } from "@/components/forms/login-form";
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
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <GalleryVerticalEnd className="size-4" aria-hidden="true" />
            </span>
            AyamNorliza Ops
          </a>
          <ThemeToggle />
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
        <div className="absolute inset-x-0 bottom-0 p-10 text-white">
          <p className="max-w-md text-balance text-lg font-medium">
            Secure access for coop operations, identity reviews, and emergency support sessions.
          </p>
        </div>
      </section>
    </main>
  );
}
