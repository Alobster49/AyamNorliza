"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
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
import { toLocaleAgnostic } from "@/lib/auth/next-path";

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
  const t = useTranslations("buyer.login");
  // Root-namespace instance for server-action error keys ("errors.buyer.*"),
  // which are full paths — distinct from `t`, which is scoped to "buyer.login".
  const tRoot = useTranslations();
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
      organizationSlug,
    });

    setLoading(false);

    if (!result.ok) {
      toast({
        title: t("loginFailedTitle"),
        // `messageKey` is a dynamic full path (e.g. "errors.buyer.login.invalidCredentials");
        // next-intl's typed `t()` only accepts literal keys, so this is cast at the call site.
        description: result.messageKey ? tRoot(result.messageKey as never) : t("loginFailedDefault"),
        variant: "destructive",
      });
      return;
    }

    toast({
      title: t("welcomeBackToastTitle"),
      description: t("loggedInDesc"),
    });

    // `next` may arrive locale-prefixed ("/ms/buyer_portal/{slug}/orders") -
    // `toLocaleAgnostic` validates it and strips the prefix so the
    // same-portal check below compares against `buyerPortalPrefix`-shaped
    // paths, which never carry one. Same-portal paths only — never redirect
    // off-portal or cross-org.
    const rawNext = toLocaleAgnostic(searchParams.get("next"));
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
        title: t("passwordMismatchTitle"),
        description: t("passwordMismatchDesc"),
        variant: "destructive",
      });
      return;
    }

    if (signupData.password.length < 8) {
      toast({
        title: t("passwordTooShortTitle"),
        description: t("passwordTooShortDesc"),
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
        title: t("signupFailedTitle"),
        // Prefer the translated `messageKey` — the action always sets one on
        // failure — so BM readers see `errors.buyer.signup.invalidPhone`
        // instead of the untranslated English prose that used to live in
        // `fieldErrors.phone`.
        description: result.messageKey
          ? tRoot(result.messageKey as never)
          : result.fieldErrors?.phone?.[0] || t("signupFailedDefault"),
        variant: "destructive",
      });
      return;
    }

    toast({
      title: t("accountCreatedTitle"),
      description: t("accountCreatedDesc"),
    });

    // `next` may arrive locale-prefixed ("/ms/buyer_portal/{slug}/orders") -
    // `toLocaleAgnostic` validates it and strips the prefix so the
    // same-portal check below compares against `buyerPortalPrefix`-shaped
    // paths, which never carry one. Same-portal paths only — never redirect
    // off-portal or cross-org.
    const rawNext = toLocaleAgnostic(searchParams.get("next"));
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
            {mode === "login" ? t("welcomeBackTitle") : t("createAccountTitle")}
          </CardTitle>
          <CardDescription>
            {mode === "login" ? t("loginDescription") : t("signupDescription")}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="relative grid grid-cols-2 rounded-full bg-secondary p-1" role="radiogroup" aria-label={t("modeAriaLabel")}>
            {(
              [
                ["login", t("loginTab")],
                ["signup", t("signupTab")],
              ] as const
            ).map(([m, label]) => (
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
                <Label htmlFor="login-email">{t("emailLabel")}</Label>
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
                <Label htmlFor="login-password">{t("passwordLabel")}</Label>
                <Input
                  id="login-password"
                  type="password"
                  placeholder={t("loginPasswordPlaceholder")}
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
                    {t("loggingIn")}
                  </>
                ) : (
                  t("loginTab")
                )}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleSignup} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="signup-name">{t("nameLabel")}</Label>
                <Input
                  id="signup-name"
                  type="text"
                  placeholder="Aminah binti Ali"
                  value={signupData.displayName}
                  onChange={(e) =>
                    setSignupData({ ...signupData, displayName: e.target.value })
                  }
                  required
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-email">{t("emailLabel")}</Label>
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
                <Label htmlFor="signup-phone">{t("phoneLabel")}</Label>
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
                <p className="text-xs text-muted-foreground">{t("phoneHint")}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-password">{t("passwordLabel")}</Label>
                <Input
                  id="signup-password"
                  type="password"
                  placeholder={t("signupPasswordPlaceholder")}
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
                <Label htmlFor="signup-confirm">{t("confirmPasswordLabel")}</Label>
                <Input
                  id="signup-confirm"
                  type="password"
                  placeholder={t("confirmPasswordPlaceholder")}
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
                    {t("signingUp")}
                  </>
                ) : (
                  t("signupTab")
                )}
              </Button>
            </form>
          )}
        </CardContent>

        <CardFooter className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            <Link href={`/buyer_portal/${organizationSlug}/shop`} className="text-primary hover:underline">
              {t("continueWithoutAccount")}
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
