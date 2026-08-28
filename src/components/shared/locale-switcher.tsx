"use client";

import { Suspense, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
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
 *
 * `usePathname` carries no query string, so it's read separately via
 * `useSearchParams` (a `next/navigation` concern, not a locale-aware one -
 * search params aren't locale-prefixed) and reattached before the switch.
 * Without this, filters like `?actor=...&from=...` on the audit log, or a
 * `?next=...` return path on the login page, are silently dropped.
 *
 * `useSearchParams` requires a Suspense boundary to avoid a CSR bailout on
 * statically-rendered pages (this control appears on the public /signup
 * page) - the exported `LocaleSwitcher` below wraps the real implementation
 * so every existing caller keeps working unchanged.
 */
function LocaleSwitcherControl() {
  const t = useTranslations("common");
  const activeLocale = useLocale() as AppLocale;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function selectLocale(locale: AppLocale) {
    if (locale === activeLocale) return;
    const query = searchParams.toString();
    const destination = query ? `${pathname}?${query}` : pathname;
    startTransition(async () => {
      await setLocaleAction(locale);
      router.replace(destination, { locale });
      router.refresh();
    });
  }

  return (
    <div
      role="group"
      aria-label={t("changeLanguage")}
      className="inline-flex h-11 shrink-0 items-center gap-0.5 rounded-2xl border bg-muted/40 p-0.5 sm:h-8"
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
              "inline-flex h-full items-center justify-center rounded-[14px] px-3 text-xs font-medium transition-all outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-60 sm:px-2.5",
              isActive
                ? "bg-background text-foreground shadow-sm"
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

/** Same-shaped, disabled fallback shown only for the instant before hydration. */
function LocaleSwitcherFallback() {
  return (
    <div
      role="group"
      aria-hidden="true"
      className="inline-flex h-11 shrink-0 items-center gap-0.5 rounded-2xl border bg-muted/40 p-0.5 sm:h-8"
    >
      {SUPPORTED_LOCALES.map((locale) => (
        <span
          key={locale}
          className="inline-flex h-full items-center justify-center rounded-[14px] px-3 text-xs font-medium text-muted-foreground opacity-60 sm:px-2.5"
        >
          {LOCALE_SHORT_LABELS[locale]}
        </span>
      ))}
    </div>
  );
}

export function LocaleSwitcher() {
  return (
    <Suspense fallback={<LocaleSwitcherFallback />}>
      <LocaleSwitcherControl />
    </Suspense>
  );
}
