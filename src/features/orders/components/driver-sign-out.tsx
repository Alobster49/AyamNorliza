"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { LogOut } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { signOutAction } from "@/features/identity-access/server/auth-actions";
import { Button } from "@/components/ui/button";

/** Sign out from the driver deck. The deck is the whole app for a driver --
 * there is no sidebar to hang the account menu off, so the button lives in the
 * run header (and on the "no run" screens, where a driver who signed in as the
 * wrong account would otherwise be stuck). */
export function DriverSignOutButton({
  className,
  variant = "outline",
}: {
  className?: string;
  /** The day-closed screen makes signing out the primary action; everywhere else it is a quiet outline. */
  variant?: "outline" | "default";
}) {
  const t = useTranslations("common");
  const router = useRouter();
  const [busy, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      className={`h-9 shrink-0 gap-1.5 ${className ?? ""}`}
      disabled={busy}
      onClick={() =>
        startTransition(async () => {
          await signOutAction();
          router.push("/login");
        })
      }
    >
      <LogOut className="size-4" aria-hidden />
      {/* The quiet header button is icon-only on a phone; a primary one says what it does. */}
      <span className={variant === "default" ? "" : "sr-only sm:not-sr-only"}>{t("signOut")}</span>
    </Button>
  );
}
