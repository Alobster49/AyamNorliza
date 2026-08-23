"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { motion } from "motion/react";
import { useCart } from "@/features/buyer/components/cart-context";
import { buyerSignInAction, buyerSignUpAction } from "@/features/buyer-auth/server/auth-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

type LoginPageProps = {
  params: Promise<{ organizationSlug: string }>;
};

type Mode = "login" | "signup";

export default function LoginPage(props: LoginPageProps) {
  return (
    <Suspense>
      <LoginPageInner {...props} />
    </Suspense>
  );
}

function LoginPageInner({ params }: LoginPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>("login");
  const [loading, setLoading] = useState(false);
  const [organizationSlug, setOrganizationSlug] = useState<string>("");

  const [loginData, setLoginData] = useState({
    email: "",
    password: "",
  });

  const [signupData, setSignupData] = useState({
    displayName: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });

  // Get org slug from params. Resolving the promise in an effect (rather
  // than during render) avoids firing setState on every render pass and
  // the race where an early form submit reads organizationSlug before the
  // promise settles.
  useEffect(() => {
    let cancelled = false;
    params.then((p) => {
      if (!cancelled) setOrganizationSlug(p.organizationSlug);
    });
    return () => {
      cancelled = true;
    };
  }, [params]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const result = await buyerSignInAction({
      email: loginData.email,
      password: loginData.password,
    });

    setLoading(false);

    if (!result.ok) {
      toast({
        title: "Login failed",
        description: result.message || "Invalid email or password.",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Welcome back!",
      description: "You have been signed in.",
    });

    const rawNext = searchParams.get("next");
    // Same-portal relative paths only — never redirect off-portal or cross-org.
    const nextPath =
      rawNext && rawNext.startsWith(`/buyer_portal/${organizationSlug}/`)
        ? rawNext
        : null;

    router.push(nextPath ?? `/buyer_portal/${organizationSlug}/shop`);
    router.refresh();
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (signupData.password !== signupData.confirmPassword) {
      toast({
        title: "Passwords don't match",
        description: "Please make sure your passwords match.",
        variant: "destructive",
      });
      return;
    }

    if (signupData.password.length < 8) {
      toast({
        title: "Password too short",
        description: "Password must be at least 8 characters.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    const result = await buyerSignUpAction({
      email: signupData.email,
      password: signupData.password,
      displayName: signupData.displayName,
      phone: signupData.phone,
      organizationSlug,
    });

    setLoading(false);

    if (!result.ok) {
      toast({
        title: "Sign up failed",
        description: result.fieldErrors?.phone?.[0] || result.message || "Could not create account.",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Account created!",
      description: "Welcome! You can now start shopping.",
    });

    const rawNext = searchParams.get("next");
    // Same-portal relative paths only — never redirect off-portal or cross-org.
    const nextPath =
      rawNext && rawNext.startsWith(`/buyer_portal/${organizationSlug}/`)
        ? rawNext
        : null;

    router.push(nextPath ?? `/buyer_portal/${organizationSlug}/shop`);
    router.refresh();
  };

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-white">
            <Image
              src="/logo-nb-poultry.webp"
              alt="NB Poultry Processing Industries"
              width={48}
              height={48}
              className="size-full rounded-lg object-contain"
            />
          </div>
          <CardTitle className="font-buyer-display text-2xl">
            {mode === "login" ? "Selamat kembali" : "Buat akaun"}
          </CardTitle>
          <CardDescription>
            {mode === "login"
              ? "Log masuk ke akaun pembeli anda"
              : "Daftar untuk mula membeli"}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="relative grid grid-cols-2 rounded-full bg-secondary p-1" role="radiogroup" aria-label="Mod akaun">
            {([["login", "Log masuk"], ["signup", "Daftar"]] as const).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                disabled={loading}
                onClick={() => setMode(m)}
                className="relative z-10 rounded-full py-2 text-sm font-medium"
              >
                {mode === m && (
                  <motion.span
                    layoutId="login-mode-pill"
                    className="absolute inset-0 -z-10 rounded-full bg-card shadow-sm"
                    transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                  />
                )}
                {label}
              </button>
            ))}
          </div>

          {mode === "login" ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  placeholder="you@example.com"
                  value={loginData.email}
                  onChange={(e) =>
                    setLoginData({ ...loginData, email: e.target.value })
                  }
                  required
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">Password</Label>
                <Input
                  id="login-password"
                  type="password"
                  placeholder="Your password"
                  value={loginData.password}
                  onChange={(e) =>
                    setLoginData({ ...loginData, password: e.target.value })
                  }
                  required
                  className="h-11"
                />
              </div>
              <Button
                type="submit"
                className="w-full rounded-full bg-primary py-3 font-medium text-primary-foreground transition-transform active:scale-[0.97]"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Log masuk…
                  </>
                ) : (
                  "Log masuk"
                )}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleSignup} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="signup-name">Your Name</Label>
                <Input
                  id="signup-name"
                  type="text"
                  placeholder="John Doe"
                  value={signupData.displayName}
                  onChange={(e) =>
                    setSignupData({ ...signupData, displayName: e.target.value })
                  }
                  required
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-email">Email</Label>
                <Input
                  id="signup-email"
                  type="email"
                  placeholder="you@example.com"
                  value={signupData.email}
                  onChange={(e) =>
                    setSignupData({ ...signupData, email: e.target.value })
                  }
                  required
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-phone">Phone (for WhatsApp)</Label>
                <Input
                  id="signup-phone"
                  type="tel"
                  inputMode="tel"
                  placeholder="012-345 6789"
                  value={signupData.phone}
                  onChange={(e) =>
                    setSignupData({ ...signupData, phone: e.target.value })
                  }
                  required
                  className="h-11"
                />
                <p className="text-xs text-muted-foreground">
                  Kami akan hantar kemas kini pesanan ke nombor ini.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-password">Password</Label>
                <Input
                  id="signup-password"
                  type="password"
                  placeholder="At least 8 characters"
                  value={signupData.password}
                  onChange={(e) =>
                    setSignupData({ ...signupData, password: e.target.value })
                  }
                  minLength={8}
                  required
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-confirm">Confirm Password</Label>
                <Input
                  id="signup-confirm"
                  type="password"
                  placeholder="Repeat password"
                  value={signupData.confirmPassword}
                  onChange={(e) =>
                    setSignupData({
                      ...signupData,
                      confirmPassword: e.target.value,
                    })
                  }
                  required
                  className="h-11"
                />
              </div>
              <Button
                type="submit"
                className="w-full rounded-full bg-primary py-3 font-medium text-primary-foreground transition-transform active:scale-[0.97]"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Mendaftar…
                  </>
                ) : (
                  "Daftar"
                )}
              </Button>
            </form>
          )}
        </CardContent>

        <CardFooter className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            <Link href={`/buyer_portal/${organizationSlug}/shop`} className="text-primary hover:underline">
              Teruskan beli tanpa akaun
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
