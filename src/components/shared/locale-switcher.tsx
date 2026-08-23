"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { setLocaleAction } from "@/lib/i18n/actions";
import {
  LOCALE_LABELS,
  LOCALE_SHORT_LABELS,
  SUPPORTED_LOCALES,
  type AppLocale,
} from "@/lib/i18n/locales";
import { cn } from "@/lib/utils";

/**
 * Segmented EN | BM control.
 *
 * `usePathname` here comes from `@/i18n/navigation`, so it returns the path
 * WITHOUT the locale segment. Passing that to `router.replace` with an
 * explicit `locale` is what keeps the user on the page they were reading
 * instead of bouncing them to the shop or the dashboard root.
 */
export function LocaleSwitcher() {
  const t = useTranslations("common");
  const activeLocale = useLocale() as AppLocale;
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function selectLocale(locale: AppLocale) {
    if (locale === activeLocale) return;
    startTransition(async () => {
      await setLocaleAction(locale);
      router.replace(pathname, { locale });
      router.refresh();
    });
  }

  return (
    <div
      role="group"
      aria-label={t("changeLanguage")}
      className="inline-flex items-center rounded-md border p-0.5"
    >
      {SUPPORTED_LOCALES.map((locale) => {
        const isActive = locale === activeLocale;
        return (
          <button
            key={locale}
            type="button"
            disabled={isPending}
            aria-current={isActive ? "true" : undefined}
            // "BM" is the visible label, but a screen reader should say the
            // language, not the abbreviation.
            aria-label={LOCALE_LABELS[locale]}
            title={LOCALE_LABELS[locale]}
            onClick={() => selectLocale(locale)}
            className={cn(
              "rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-60",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {LOCALE_SHORT_LABELS[locale]}
          </button>
        );
      })}
    </div>
  );
}
