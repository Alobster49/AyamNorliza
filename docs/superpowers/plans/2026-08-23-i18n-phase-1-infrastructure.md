# i18n Phase 1 — Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship locale-prefixed routing, a working language switcher, and persisted language choice, with the `common` and `auth` namespaces fully translated, while every other surface keeps its current hardcoded strings and continues to render.

**Architecture:** `next-intl` provides locale routing (`/en/...`, `/ms/...`), server and client translation, and typed message keys. All page routes move under a `src/app/[locale]/` segment; `src/app/api/` does not move. One middleware runs next-intl's routing first, then republishes the existing `x-pathname` header that Server Components depend on. Language choice lives in a `NEXT_LOCALE` cookie for everyone and additionally in `profiles.locale` / `buyers.locale` for signed-in users.

**Tech Stack:** Next.js 16.2.9 (App Router, Turbopack), React 18.3, TypeScript 5.6, next-intl 4.13, Supabase (Postgres + RLS), Vitest 4, Playwright 1.47, Tailwind 4, shadcn/ui.

**Source spec:** `docs/superpowers/specs/2026-08-23-i18n-en-ms-design.md`

## Scope of this plan

This plan covers **Phase 1 only** of the four phases in the spec. Phases 2–4 (buyer portal copy, seller operations copy, dashboard/settings/email copy) each get their own plan, written after the phase before it has merged. That staging is the spec's stated mitigation against a 150-file branch rotting on the side.

Phase 1 is done when: both `/en` and `/ms` URLs render every existing page, the switcher works on every shell, the choice survives reload and re-login, and the login/signup/MFA/invite pages plus the shared chrome read from the message catalogs. Everything else still shows its hardcoded English or BM. That is expected and is not a bug.

## Global Constraints

- Locales are exactly `en` and `ms`. `en` is the default and the fallback.
- `localePrefix` is `'always'` — every URL carries a prefix; there is no bare-URL rendering.
- Database enum values (order status, run status, roles, zones) stay English. Only display labels translate. No schema value changes in this plan.
- `src/middleware.ts` keeps that filename. Do **not** rename it to `proxy.ts` — Turbopack dev on 16.2.9 does not register `src/proxy.ts`. The reason is documented in the file's header comment; keep that comment.
- The middleware matcher must keep excluding `_next` — routing `_next/webpack-hmr` through middleware breaks HMR in dev.
- New DB columns need explicit grants, per this repo's standing gotcha.
- New migration files must sort after `20260823000012`, the highest version already applied to production.
- `en.json` is the schema source of truth; `ms.json` must have an identical key set.
- Never run `supabase db reset` against anything but the local stack.

---

### Task 1: Locale primitives and message catalogs

Pure TypeScript and JSON, no framework. Everything later imports from here, and this is the only task whose tests can run before next-intl is installed.

**Files:**
- Create: `src/lib/i18n/locales.ts`
- Create: `src/lib/i18n/locales.test.ts`
- Create: `src/lib/i18n/catalog.test.ts`
- Create: `src/messages/en.json`
- Create: `src/messages/ms.json`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SUPPORTED_LOCALES: readonly ['en', 'ms']`
  - `DEFAULT_LOCALE: 'en'`
  - `type AppLocale = 'en' | 'ms'`
  - `isSupportedLocale(value: unknown): value is AppLocale`
  - `LOCALE_LABELS: Record<AppLocale, string>` → `{ en: 'English', ms: 'Bahasa Melayu' }`
  - `LOCALE_SHORT_LABELS: Record<AppLocale, string>` → `{ en: 'EN', ms: 'BM' }`
  - `src/messages/en.json` and `src/messages/ms.json` with namespaces `common` and `auth`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/i18n/locales.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALE_LABELS,
  LOCALE_SHORT_LABELS,
  SUPPORTED_LOCALES,
  isSupportedLocale,
} from "./locales";

describe("locales", () => {
  it("supports exactly en and ms", () => {
    expect(SUPPORTED_LOCALES).toEqual(["en", "ms"]);
  });

  it("defaults to en", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(SUPPORTED_LOCALES).toContain(DEFAULT_LOCALE);
  });

  it("accepts supported locales", () => {
    expect(isSupportedLocale("en")).toBe(true);
    expect(isSupportedLocale("ms")).toBe(true);
  });

  it("rejects anything else, including near-misses and non-strings", () => {
    expect(isSupportedLocale("EN")).toBe(false);
    expect(isSupportedLocale("en-US")).toBe(false);
    expect(isSupportedLocale("")).toBe(false);
    expect(isSupportedLocale(null)).toBe(false);
    expect(isSupportedLocale(undefined)).toBe(false);
    expect(isSupportedLocale(42)).toBe(false);
  });

  it("has a label for every supported locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(LOCALE_LABELS[locale]).toBeTruthy();
      expect(LOCALE_SHORT_LABELS[locale]).toBeTruthy();
    }
  });
});
```

Create `src/lib/i18n/catalog.test.ts`. This is the drift guard — it is the reason a missing BM string fails in CI instead of shipping:

```ts
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";

/** Flattens {a: {b: "x"}} to ["a.b"] so the diff names the exact missing key. */
function flattenKeys(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("message catalogs", () => {
  const enKeys = flattenKeys(en).sort();
  const msKeys = flattenKeys(ms).sort();

  it("ms has no missing keys", () => {
    expect(enKeys.filter((key) => !msKeys.includes(key))).toEqual([]);
  });

  it("ms has no extra keys", () => {
    expect(msKeys.filter((key) => !enKeys.includes(key))).toEqual([]);
  });

  it("has no empty string values in either catalog", () => {
    const empties = [
      ...flattenValues(en).filter(([, v]) => v.trim() === "").map(([k]) => `en:${k}`),
      ...flattenValues(ms).filter(([, v]) => v.trim() === "").map(([k]) => `ms:${k}`),
    ];
    expect(empties).toEqual([]);
  });
});

/** Same walk as flattenKeys, but carries the leaf string along. */
function flattenValues(value: unknown, prefix = ""): Array<[string, string]> {
  if (typeof value === "string") return [[prefix, value]];
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flattenValues(child, prefix ? `${prefix}.${key}` : key),
  );
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/lib/i18n
```

Expected: FAIL — `Failed to resolve import "./locales"` and `Failed to resolve import "@/messages/en.json"`.

- [ ] **Step 3: Write the locale primitives**

Create `src/lib/i18n/locales.ts`:

```ts
/**
 * The single source of truth for which languages the app supports.
 *
 * Deliberately free of `next-intl` and `next` imports: middleware, server
 * actions, client components, and plain Vitest specs all need this list, and
 * a framework import here would drag `next/server` into the test runner.
 */

export const SUPPORTED_LOCALES = ["en", "ms"] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "en";

/** Full names, for the settings row where there is space to spell it out. */
export const LOCALE_LABELS: Record<AppLocale, string> = {
  en: "English",
  ms: "Bahasa Melayu",
};

/** Two-letter names, for the compact header control. */
export const LOCALE_SHORT_LABELS: Record<AppLocale, string> = {
  en: "EN",
  ms: "BM",
};

export function isSupportedLocale(value: unknown): value is AppLocale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}
```

- [ ] **Step 4: Write the message catalogs**

Create `src/messages/en.json`. These are the only strings Phase 1 translates — shared chrome and the four auth pages:

```json
{
  "common": {
    "appName": "AyamNorliza Ops",
    "language": "Language",
    "changeLanguage": "Change language",
    "workspaceSuffix": "{section} workspace",
    "loading": "Loading…",
    "save": "Save",
    "cancel": "Cancel",
    "back": "Back",
    "signOut": "Sign out",
    "toggleTheme": "Toggle color theme",
    "openMenu": "Open menu",
    "closeMenu": "Close menu",
    "userMenu": "User menu"
  },
  "auth": {
    "login": {
      "title": "Sign in",
      "subtitle": "Use your work email to continue.",
      "emailLabel": "Email",
      "passwordLabel": "Password",
      "submit": "Sign in",
      "submitting": "Signing in…",
      "forgotPassword": "Forgot your password?",
      "noAccount": "Don't have an account?",
      "signUpLink": "Sign up"
    },
    "signup": {
      "title": "Create your account",
      "subtitle": "You need an invite from your organization owner.",
      "submit": "Create account",
      "submitting": "Creating account…",
      "haveAccount": "Already have an account?",
      "signInLink": "Sign in"
    },
    "mfa": {
      "title": "Two-factor authentication",
      "subtitle": "Enter the 6-digit code from your authenticator app.",
      "codeLabel": "Authentication code",
      "submit": "Verify",
      "submitting": "Verifying…"
    },
    "invite": {
      "title": "Accept your invitation",
      "subtitle": "Set a password to finish joining {organizationName}.",
      "submit": "Accept invitation",
      "submitting": "Accepting…",
      "expired": "This invitation link has expired. Ask your organization owner to send a new one."
    },
    "errors": {
      "invalidCredentials": "That email and password combination did not match.",
      "rateLimited": "Too many attempts. Try again in a few minutes.",
      "unexpected": "Something went wrong. Try again."
    }
  }
}
```

Create `src/messages/ms.json` with the identical key set:

```json
{
  "common": {
    "appName": "AyamNorliza Ops",
    "language": "Bahasa",
    "changeLanguage": "Tukar bahasa",
    "workspaceSuffix": "Ruang kerja {section}",
    "loading": "Memuatkan…",
    "save": "Simpan",
    "cancel": "Batal",
    "back": "Kembali",
    "signOut": "Log keluar",
    "toggleTheme": "Tukar tema warna",
    "openMenu": "Buka menu",
    "closeMenu": "Tutup menu",
    "userMenu": "Menu pengguna"
  },
  "auth": {
    "login": {
      "title": "Log Masuk",
      "subtitle": "Guna emel kerja anda untuk teruskan.",
      "emailLabel": "Emel",
      "passwordLabel": "Kata laluan",
      "submit": "Log Masuk",
      "submitting": "Sedang log masuk…",
      "forgotPassword": "Lupa kata laluan?",
      "noAccount": "Belum ada akaun?",
      "signUpLink": "Daftar"
    },
    "signup": {
      "title": "Daftar akaun",
      "subtitle": "Anda perlukan jemputan daripada pemilik organisasi.",
      "submit": "Daftar akaun",
      "submitting": "Sedang daftar…",
      "haveAccount": "Sudah ada akaun?",
      "signInLink": "Log Masuk"
    },
    "mfa": {
      "title": "Pengesahan dua faktor",
      "subtitle": "Masukkan kod 6 digit dari aplikasi pengesah anda.",
      "codeLabel": "Kod pengesahan",
      "submit": "Sahkan",
      "submitting": "Sedang sahkan…"
    },
    "invite": {
      "title": "Terima jemputan anda",
      "subtitle": "Tetapkan kata laluan untuk sertai {organizationName}.",
      "submit": "Terima jemputan",
      "submitting": "Sedang terima…",
      "expired": "Pautan jemputan ini sudah tamat tempoh. Minta pemilik organisasi hantar yang baharu."
    },
    "errors": {
      "invalidCredentials": "Emel dan kata laluan itu tidak sepadan.",
      "rateLimited": "Terlalu banyak cubaan. Cuba lagi dalam beberapa minit.",
      "unexpected": "Ada masalah berlaku. Cuba lagi."
    }
  }
}
```

- [ ] **Step 5: Confirm TypeScript can import JSON**

Check that `tsconfig.json` has `"resolveJsonModule": true` under `compilerOptions`. If it is absent, add it — `next dev` tolerates JSON imports but `tsc --noEmit` does not without it.

```bash
grep resolveJsonModule tsconfig.json || echo "MISSING - add it"
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run src/lib/i18n
```

Expected: PASS, 8 tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/i18n src/messages tsconfig.json
git commit -m "feat(i18n): locale primitives and en/ms message catalogs"
```

---

### Task 2: Wire next-intl

Installs the dependency and creates the three config modules everything else imports. No route changes yet — after this task the app still renders exactly as before.

**Files:**
- Modify: `package.json` (dependency)
- Create: `src/i18n/routing.ts`
- Create: `src/i18n/navigation.ts`
- Create: `src/i18n/request.ts`
- Create: `src/lib/i18n/routing-contract.test.ts`
- Modify: `next.config.mjs`

**Interfaces:**
- Consumes: `SUPPORTED_LOCALES`, `DEFAULT_LOCALE` from Task 1.
- Produces:
  - `routing` (from `defineRouting`) with `.locales` and `.defaultLocale`
  - `Link`, `redirect`, `usePathname`, `useRouter`, `getPathname` from `src/i18n/navigation.ts` — every internal navigation in later tasks uses these, not `next/link` or `next/navigation`
  - default-exported request config from `src/i18n/request.ts`

- [ ] **Step 1: Install next-intl**

```bash
npm install next-intl@^4.13
```

Expected: adds `next-intl` to `dependencies`. Its peer range covers `next ^16.0.0` and `react ^18.0.0`, so npm should not warn.

- [ ] **Step 2: Write the failing contract test**

Create `src/lib/i18n/routing-contract.test.ts`. This exists so the routing config and the locale list cannot drift apart silently:

```ts
import { describe, expect, it } from "vitest";
import { routing } from "@/i18n/routing";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "./locales";

describe("routing config", () => {
  it("uses the shared locale list", () => {
    expect([...routing.locales]).toEqual([...SUPPORTED_LOCALES]);
  });

  it("uses the shared default locale", () => {
    expect(routing.defaultLocale).toBe(DEFAULT_LOCALE);
  });

  it("always prefixes the locale", () => {
    expect(routing.localePrefix).toBe("always");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run src/lib/i18n/routing-contract.test.ts
```

Expected: FAIL — `Failed to resolve import "@/i18n/routing"`.

- [ ] **Step 4: Create the routing config**

Create `src/i18n/routing.ts`:

```ts
import { defineRouting } from "next-intl/routing";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "@/lib/i18n/locales";

/**
 * `localePrefix: 'always'` means every URL carries `/en` or `/ms`. The
 * alternative ('as-needed') hides the default locale's prefix, which forces
 * next-intl to rewrite requests — and a rewrite would collide with the
 * `x-pathname` header that `src/middleware.ts` publishes. Always-prefix keeps
 * the middleware to a redirect-or-passthrough, which is far easier to compose.
 */
export const routing = defineRouting({
  locales: SUPPORTED_LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "always",
});
```

- [ ] **Step 5: Create the navigation wrappers**

Create `src/i18n/navigation.ts`:

```ts
import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * Import `Link`, `redirect`, `usePathname`, and `useRouter` from HERE, never
 * from `next/link` or `next/navigation`, in any component under
 * `src/app/[locale]`.
 *
 * The plain Next versions take literal paths like `/acme/orders`. With
 * `localePrefix: 'always'` that URL does not exist — the middleware answers it
 * with a 307 to `/en/acme/orders`. The page still loads, so this fails
 * quietly: the user gets an extra round trip, a full document load instead of
 * a client transition, and their chosen locale silently resets to whatever the
 * cookie says.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
```

- [ ] **Step 6: Create the request config**

Create `src/i18n/request.ts`:

```ts
import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  // Corresponds to the `[locale]` segment. It can be undefined for requests
  // that never went through the middleware, so it is validated, not trusted.
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    // Malaysia has no DST and the whole business runs in one zone. Setting it
    // explicitly stops server and client from formatting dates differently.
    timeZone: "Asia/Kuala_Lumpur",
  };
});
```

- [ ] **Step 7: Register the plugin in next.config.mjs**

Open `next.config.mjs`. Add the import at the top of the file, next to the existing imports:

```js
import createNextIntlPlugin from "next-intl/plugin";
```

Immediately before the final export, add:

```js
const withNextIntl = createNextIntlPlugin({
  experimental: {
    // Generates the `Messages` type from en.json so `t('...')` keys are
    // typechecked. en.json is the schema source of truth.
    createMessagesDeclaration: "./src/messages/en.json",
  },
});
```

Then change the final export from `export default nextConfig;` to:

```js
export default withNextIntl(nextConfig);
```

Leave `turbopack: { root: import.meta.dirname }` and the `remotePatterns` block exactly as they are — the Turbopack root pin is what stops a git worktree from serving the parent checkout's `src/app`.

- [ ] **Step 8: Run the test to verify it passes**

```bash
npx vitest run src/lib/i18n
```

Expected: PASS, 11 tests.

- [ ] **Step 9: Verify the app still builds unchanged**

```bash
npm run typecheck && npm run build
```

Expected: both succeed. No routes have moved yet, so the route list in the build output should be identical to before.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json next.config.mjs src/i18n src/lib/i18n
git commit -m "feat(i18n): add next-intl routing, navigation, and request config"
```

---

### Task 3: Move routes under `[locale]` and rebuild the root layout

The mechanical heart of the phase, and the riskiest single step. Do it in one commit so the tree is never half-moved.

**Files:**
- Move: `src/app/(auth)`, `src/app/(dashboard)`, `src/app/(seller)`, `src/app/[organizationSlug]`, `src/app/buyer_portal`, `src/app/drive`, `src/app/page.tsx` → under `src/app/[locale]/`
- Delete: `src/app/layout.tsx` (its content moves)
- Create: `src/app/[locale]/layout.tsx`
- Modify: `src/app/not-found.tsx`
- Unchanged: `src/app/api/`, `src/app/globals.css`

**Interfaces:**
- Consumes: `routing` from Task 2.
- Produces: a `[locale]` route segment; `params.locale` is available to every page and layout beneath it.

- [ ] **Step 1: Move the route directories**

```bash
mkdir -p "src/app/[locale]"
git mv "src/app/(auth)" "src/app/[locale]/(auth)"
git mv "src/app/(dashboard)" "src/app/[locale]/(dashboard)"
git mv "src/app/(seller)" "src/app/[locale]/(seller)"
git mv "src/app/[organizationSlug]" "src/app/[locale]/[organizationSlug]"
git mv src/app/buyer_portal "src/app/[locale]/buyer_portal"
git mv src/app/drive "src/app/[locale]/drive"
git mv src/app/page.tsx "src/app/[locale]/page.tsx"
```

Verify only `api/`, `globals.css`, `layout.tsx`, `not-found.tsx`, and `[locale]/` remain at the top:

```bash
ls src/app
```

- [ ] **Step 2: Create the locale root layout**

Create `src/app/[locale]/layout.tsx`. This becomes the app's root layout — it owns `<html>` and `<body>`, which is why the old `src/app/layout.tsx` must go:

```tsx
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import "../globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "AyamNorliza Ops",
  description: "Chicken-coop operations platform (MOD-01 phase).",
  icons: {
    icon: "/logo-nb-poultry.webp",
  },
};

export const viewport: Viewport = {
  themeColor: "#f60505",
  width: "device-width",
  initialScale: 1,
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // A hand-typed `/de/...` must 404, not fall back to English. Without this
  // check the segment would happily render with the default catalog.
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={cn("font-sans", inter.variable)}
    >
      <body>
        <NextIntlClientProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <TooltipProvider>{children}</TooltipProvider>
            <Toaster />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Delete the old root layout**

```bash
git rm src/app/layout.tsx
```

- [ ] **Step 4: Give the global not-found its own document**

`src/app/not-found.tsx` now sits outside every layout, so it must render `<html>` and `<body>` itself or Next will error. Replace its contents with:

```tsx
import "./globals.css";

/**
 * Rendered for paths outside any `[locale]` segment — which after the
 * middleware means genuinely unroutable URLs. It carries its own document
 * because there is no root layout above it any more.
 */
export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body>
        <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-8 text-center">
          <h1 className="text-2xl font-semibold">Page not found</h1>
          <p className="text-muted-foreground">
            The page you are looking for does not exist.
          </p>
          <a className="underline" href="/en">
            Go home
          </a>
        </main>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Typecheck and build**

```bash
npm run typecheck && npm run build
```

Expected: PASS. In the route list every page is now prefixed with `/[locale]`, and `/api/...` routes are unchanged. If the build complains that a root layout is missing, `src/app/layout.tsx` was not deleted.

- [ ] **Step 6: Smoke-test in dev**

```bash
npm run dev
```

Then visit `http://localhost:9999/en/login` and `http://localhost:9999/ms/login`. Both must render the login page (still in English — Task 8 translates it). `http://localhost:9999/login` will 404 for now; the middleware in Task 4 is what makes it redirect.

- [ ] **Step 7: Commit**

```bash
git add -A src/app
git commit -m "refactor(i18n): move routes under [locale] and rebuild root layout"
```

---

### Task 4: Compose the middleware

Runs next-intl's routing, then republishes `x-pathname`. Both jobs must survive; losing the header sends expired sessions back to the org landing page instead of the page they were on.

**Files:**
- Create: `src/lib/i18n/middleware-compose.ts`
- Create: `src/lib/i18n/middleware-compose.test.ts`
- Modify: `src/middleware.ts`

**Interfaces:**
- Consumes: `routing` from Task 2, `PATHNAME_HEADER` from `src/lib/auth/next-path.ts`.
- Produces: `isRedirectResponse(response: Response): boolean` and `copyResponseMetadata(from: Response, to: NextResponse): NextResponse` — both used only by `src/middleware.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/i18n/middleware-compose.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import { copyResponseMetadata, isRedirectResponse } from "./middleware-compose";

describe("isRedirectResponse", () => {
  it("detects a redirect by its Location header", () => {
    const redirect = NextResponse.redirect("http://localhost/en/login");
    expect(isRedirectResponse(redirect)).toBe(true);
  });

  it("treats a pass-through as not a redirect", () => {
    expect(isRedirectResponse(NextResponse.next())).toBe(false);
  });
});

describe("copyResponseMetadata", () => {
  it("carries cookies from the source onto the target", () => {
    const from = NextResponse.next();
    from.cookies.set("NEXT_LOCALE", "ms");
    const to = copyResponseMetadata(from, NextResponse.next());
    expect(to.cookies.get("NEXT_LOCALE")?.value).toBe("ms");
  });

  it("carries next-intl's Link header onto the target", () => {
    const from = NextResponse.next();
    from.headers.set("link", '<http://localhost/ms>; rel="alternate"');
    const to = copyResponseMetadata(from, NextResponse.next());
    expect(to.headers.get("link")).toBe('<http://localhost/ms>; rel="alternate"');
  });

  it("does not copy Next's internal middleware directives", () => {
    const from = NextResponse.next();
    from.headers.set("x-middleware-next", "1");
    const to = copyResponseMetadata(from, NextResponse.next());
    // The target has its own directive from its own NextResponse.next() call;
    // overwriting it with the source's would discard the request headers the
    // target is carrying.
    expect(to.headers.get("x-middleware-override-headers")).toBe(
      NextResponse.next().headers.get("x-middleware-override-headers"),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/i18n/middleware-compose.test.ts
```

Expected: FAIL — `Failed to resolve import "./middleware-compose"`.

- [ ] **Step 3: Write the compose helpers**

Create `src/lib/i18n/middleware-compose.ts`:

```ts
import { NextResponse } from "next/server";

/**
 * Helpers for running two middlewares in one request.
 *
 * next-intl's middleware returns one of two things when `localePrefix` is
 * `'always'`: a redirect (bare URL to a prefixed one) or a pass-through. It
 * does not rewrite, because with an always-on prefix the incoming pathname
 * already matches the `[locale]` file route. That is what makes composing it
 * tractable — see the note in `src/i18n/routing.ts`.
 *
 * A pass-through response cannot simply be returned, because our middleware
 * also has to attach a REQUEST header, and request headers can only be set by
 * the `NextResponse.next({request})` call that creates the response. So we
 * build our own response and move next-intl's cookies and headers onto it.
 */

/** Headers that belong to the response object that created them. */
const INTERNAL_HEADERS = new Set([
  "x-middleware-next",
  "x-middleware-override-headers",
  "x-middleware-rewrite",
  "set-cookie",
]);

export function isRedirectResponse(response: Response): boolean {
  return response.headers.has("location");
}

export function copyResponseMetadata(
  from: Response,
  to: NextResponse,
): NextResponse {
  from.headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (INTERNAL_HEADERS.has(name)) return;
    // Next stamps its own request-header directives on `to`; anything starting
    // with x-middleware-request- belongs to the source response's own request
    // copy and would corrupt ours.
    if (name.startsWith("x-middleware-request-")) return;
    to.headers.set(key, value);
  });

  // Cookies move through the cookie API rather than the raw Set-Cookie header,
  // so multiple cookies survive instead of collapsing into one.
  for (const cookie of (from as NextResponse).cookies?.getAll() ?? []) {
    to.cookies.set(cookie);
  }

  return to;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/i18n/middleware-compose.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Rewrite the middleware**

Replace the body of `src/middleware.ts` with the following. **Keep the existing header comment** — including the paragraph explaining why the file is not renamed to `proxy.ts` — and add the i18n paragraph to it:

```ts
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { PATHNAME_HEADER } from "@/lib/auth/next-path";
import { routing } from "@/i18n/routing";
import {
  copyResponseMetadata,
  isRedirectResponse,
} from "@/lib/i18n/middleware-compose";

const handleI18nRouting = createMiddleware(routing);

export function middleware(request: NextRequest) {
  // next-intl runs first: it decides whether this URL needs a locale prefix.
  const i18nResponse = handleI18nRouting(request);

  // A redirect ends the request. Returning it untouched matters — attaching a
  // request header to a 307 does nothing, and rebuilding it would drop the
  // Location.
  if (isRedirectResponse(i18nResponse)) {
    return i18nResponse;
  }

  // Pass-through: rebuild so we can attach the request header. Search is
  // included so "/en/acme/orders?status=open" comes back with its filter
  // intact. The hash is browser-only and never reaches the server.
  const headers = new Headers(request.headers);
  headers.set(
    PATHNAME_HEADER,
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );

  return copyResponseMetadata(
    i18nResponse,
    NextResponse.next({ request: { headers } }),
  );
}

export const config = {
  matcher: [
    // Everything except Next internals, the API, and static assets.
    //
    // The auth routes (/login, /signup, /mfa, /auth) are NO LONGER excluded:
    // they live under `[locale]` now and need the prefix like any other page.
    //
    // The whole of `_next` stays excluded: `_next/webpack-hmr` is a websocket
    // upgrade, and running it through `NextResponse.next()` breaks HMR in dev.
    "/((?!_next/|api/|favicon.ico|.*\\.[^/]+$).*)",
  ],
};
```

- [ ] **Step 6: Verify the redirect and the header by hand**

```bash
npm run dev
```

In a second terminal:

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:9999/login
```

Expected: `307 http://localhost:9999/en/login`.

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9999/en/login
```

Expected: `200`.

Then confirm HMR still works: with `npm run dev` running, edit any string in `src/app/[locale]/(auth)/login/page.tsx` and confirm the browser updates without a manual reload. If it does not, the `_next` exclusion in the matcher was altered.

- [ ] **Step 7: Run the full test suite**

```bash
npm run typecheck && npm test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/middleware.ts src/lib/i18n
git commit -m "feat(i18n): compose next-intl routing with the pathname middleware"
```

---

### Task 5: Make the auth redirect path locale-aware

`requireUserOrRedirect` sends people to a literal `/login`, and `sanitizeNextPath` compares against literal `/login`. With a prefix in play the first costs an extra redirect hop and loses the active locale, and the second stops recognising auth paths — so a user bounced off `/en/login` could be handed `?next=/en/login` and loop.

**Files:**
- Modify: `src/lib/auth/next-path.ts`
- Create: `src/lib/auth/next-path.test.ts`
- Modify: `src/lib/auth/require-user.ts:69-77`

**Interfaces:**
- Consumes: `SUPPORTED_LOCALES` from Task 1.
- Produces:
  - `stripLocalePrefix(path: string): string` — exported from `next-path.ts`
  - `sanitizeNextPath` keeps its existing signature `(value: string | null | undefined) => string | null`

- [ ] **Step 1: Write the failing test**

Create `src/lib/auth/next-path.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sanitizeNextPath, stripLocalePrefix } from "./next-path";

describe("stripLocalePrefix", () => {
  it("removes a supported locale prefix", () => {
    expect(stripLocalePrefix("/en/acme/orders")).toBe("/acme/orders");
    expect(stripLocalePrefix("/ms/acme/orders")).toBe("/acme/orders");
  });

  it("leaves the path alone when the first segment is not a locale", () => {
    expect(stripLocalePrefix("/acme/orders")).toBe("/acme/orders");
    expect(stripLocalePrefix("/english/orders")).toBe("/english/orders");
  });

  it("returns / for a bare locale root", () => {
    expect(stripLocalePrefix("/en")).toBe("/");
    expect(stripLocalePrefix("/ms/")).toBe("/");
  });
});

describe("sanitizeNextPath with locale prefixes", () => {
  it("keeps a prefixed application path intact", () => {
    expect(sanitizeNextPath("/en/acme/orders/123")).toBe("/en/acme/orders/123");
  });

  it("rejects a prefixed auth path so sign-in cannot loop", () => {
    expect(sanitizeNextPath("/en/login")).toBeNull();
    expect(sanitizeNextPath("/ms/signup")).toBeNull();
    expect(sanitizeNextPath("/en/mfa")).toBeNull();
    expect(sanitizeNextPath("/ms/auth/callback")).toBeNull();
  });

  it("still rejects unprefixed auth paths", () => {
    expect(sanitizeNextPath("/login")).toBeNull();
  });

  it("still rejects off-site and malformed values", () => {
    expect(sanitizeNextPath("//evil.com")).toBeNull();
    expect(sanitizeNextPath("/\\evil.com")).toBeNull();
    expect(sanitizeNextPath("https://evil.com")).toBeNull();
    expect(sanitizeNextPath("/en/orders\nHost: evil")).toBeNull();
    expect(sanitizeNextPath(null)).toBeNull();
  });

  it("preserves the query string", () => {
    expect(sanitizeNextPath("/en/acme/orders?status=open")).toBe(
      "/en/acme/orders?status=open",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/auth/next-path.test.ts
```

Expected: FAIL — `stripLocalePrefix is not exported`, and the prefixed-auth-path cases fail because `/en/login` currently passes through.

- [ ] **Step 3: Update next-path.ts**

Add the import at the top of `src/lib/auth/next-path.ts`:

```ts
import { SUPPORTED_LOCALES } from "@/lib/i18n/locales";
```

Add this exported helper below the `AUTH_PATHS` constant:

```ts
/**
 * Drops a leading `/en` or `/ms` so path comparisons can be written once
 * against unprefixed paths. Returns "/" for a bare locale root.
 */
export function stripLocalePrefix(path: string): string {
  const [, first, ...rest] = path.split("/");
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(first ?? "")) {
    return path;
  }
  const remainder = rest.join("/");
  return remainder ? `/${remainder}` : "/";
}
```

Then, inside `sanitizeNextPath`, change the auth-path check so it compares against the stripped path. Replace:

```ts
  const path = value.split(/[?#]/)[0] ?? value;
  if (AUTH_PATHS.some((auth) => path === auth || path.startsWith(`${auth}/`))) {
    return null;
  }
```

with:

```ts
  const rawPath = value.split(/[?#]/)[0] ?? value;
  // Compare unprefixed: after the i18n migration the value arrives as
  // "/en/login", and a literal "/login" comparison would let it through and
  // bounce the user straight back to sign-in after signing in.
  const path = stripLocalePrefix(rawPath);
  if (AUTH_PATHS.some((auth) => path === auth || path.startsWith(`${auth}/`))) {
    return null;
  }
```

Leave the `//`, `/\`, and control-character checks exactly as they are — they run before this and are the reason the trailing-newline case in the test returns null. Note that `stripLocalePrefix` handles a trailing slash (`/ms/`) by returning `/`, so a bare locale root is never mistaken for an auth path.

- [ ] **Step 4: Make the redirect locale-aware**

In `src/lib/auth/require-user.ts`, add to the imports:

```ts
import { getLocale } from "next-intl/server";
```

Then replace the redirect line inside `requireUserOrRedirect` (currently `redirect(\`/login${qs}\`)`) so the sign-in page opens in the language the user was already reading:

```ts
      const returnPath = await returnPathFor(nextPath);
      const qs = returnPath ? `?next=${encodeURIComponent(returnPath)}` : "";
      const locale = await getLocale();
      redirect(`/${locale}/login${qs}`);
```

`getLocale()` reads the request config next-intl set up in Task 2, so it returns the active `[locale]` segment. Keep using `next/navigation`'s `redirect` here, not the one from `src/i18n/navigation.ts` — the path is being built with an explicit prefix already, and the next-intl version would add a second one.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/lib/auth
```

Expected: PASS. The existing `permissions.test.ts`, `reauth.test.ts`, and `invite-token.test.ts` must stay green.

- [ ] **Step 6: Verify the round trip by hand**

With `npm run dev` running and signed out, open `http://localhost:9999/ms/ayam-norliza-pilot/orders`. Expected: redirected to `http://localhost:9999/ms/login?next=%2Fms%2Fayam-norliza-pilot%2Forders` — Malay locale preserved, and the destination remembered.

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth
git commit -m "fix(auth): make next= sanitising and the login redirect locale-aware"
```

---

### Task 6: Persist the choice — migration and server action

**Files:**
- Create: `supabase/migrations/20260823000013_i18n_locale.sql`
- Create: `src/lib/i18n/actions.ts`
- Create: `src/lib/i18n/cookie.ts`
- Create: `src/lib/i18n/cookie.test.ts`
- Modify: `src/app/[locale]/(auth)/auth/callback/route.ts`

**Interfaces:**
- Consumes: `AppLocale`, `isSupportedLocale`, `DEFAULT_LOCALE` from Task 1.
- Produces:
  - `LOCALE_COOKIE_NAME = 'NEXT_LOCALE'` and `LOCALE_COOKIE_MAX_AGE = 31536000` from `cookie.ts`
  - `resolveLocaleFromSources(input: { urlLocale?: string | null; cookieLocale?: string | null; dbLocale?: string | null }): AppLocale` from `cookie.ts`
  - `setLocaleAction(locale: string): Promise<{ ok: true } | { ok: false; messageKey: string }>` from `actions.ts`
  - `syncLocaleCookieFromAccount(): Promise<AppLocale>` from `actions.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/i18n/cookie.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  resolveLocaleFromSources,
} from "./cookie";

describe("locale cookie constants", () => {
  it("uses the cookie name next-intl reads", () => {
    expect(LOCALE_COOKIE_NAME).toBe("NEXT_LOCALE");
  });

  it("lasts a year", () => {
    expect(LOCALE_COOKIE_MAX_AGE).toBe(60 * 60 * 24 * 365);
  });
});

describe("resolveLocaleFromSources", () => {
  it("prefers the URL over everything", () => {
    expect(
      resolveLocaleFromSources({
        urlLocale: "ms",
        cookieLocale: "en",
        dbLocale: "en",
      }),
    ).toBe("ms");
  });

  it("falls back to the cookie when there is no URL locale", () => {
    expect(
      resolveLocaleFromSources({ cookieLocale: "ms", dbLocale: "en" }),
    ).toBe("ms");
  });

  it("falls back to the database when there is no cookie", () => {
    expect(resolveLocaleFromSources({ dbLocale: "ms" })).toBe("ms");
  });

  it("falls back to en when nothing is set", () => {
    expect(resolveLocaleFromSources({})).toBe("en");
  });

  it("ignores unsupported values at every level", () => {
    expect(
      resolveLocaleFromSources({
        urlLocale: "de",
        cookieLocale: "fr",
        dbLocale: "ms",
      }),
    ).toBe("ms");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/i18n/cookie.test.ts
```

Expected: FAIL — `Failed to resolve import "./cookie"`.

- [ ] **Step 3: Write the cookie module**

Create `src/lib/i18n/cookie.ts`:

```ts
import { DEFAULT_LOCALE, isSupportedLocale, type AppLocale } from "./locales";

/** The cookie name next-intl reads by default. Changing it breaks its middleware. */
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Resolution order: URL, then cookie, then the signed-in user's stored
 * preference, then the default.
 *
 * The URL wins because the middleware guarantees a prefix is present on every
 * rendered request. If the cookie could override it, server and client would
 * disagree about which catalog to use and React would report a hydration
 * mismatch. Cookie and database values only decide where a bare URL is sent.
 */
export function resolveLocaleFromSources(input: {
  urlLocale?: string | null;
  cookieLocale?: string | null;
  dbLocale?: string | null;
}): AppLocale {
  for (const candidate of [input.urlLocale, input.cookieLocale, input.dbLocale]) {
    if (isSupportedLocale(candidate)) return candidate;
  }
  return DEFAULT_LOCALE;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/i18n/cookie.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Write the migration**

Create `supabase/migrations/20260823000013_i18n_locale.sql`. The version must sort after `20260823000012`, the highest already on production:

```sql
-- ---------------------------------------------------------------------------
-- Bilingual UI: per-user language preference.
--
-- `profiles.locale` already existed with only a length check, which would have
-- accepted 'de' or 'xx'. Both tables now enforce the same two-value set so the
-- application never has to defend against a locale it has no catalog for.
-- ---------------------------------------------------------------------------

alter table public.profiles
  drop constraint if exists profiles_locale_check;

alter table public.profiles
  add constraint profiles_locale_check
  check (locale in ('en', 'ms'));

alter table public.buyers
  add column if not exists locale text not null default 'en';

alter table public.buyers
  drop constraint if exists buyers_locale_check;

alter table public.buyers
  add constraint buyers_locale_check
  check (locale in ('en', 'ms'));

comment on column public.buyers.locale is
  'UI language for this buyer: en or ms. Also selects the language of transactional email.';

-- Grants on the new column. A new column on an existing table does not inherit
-- column-level grants where they were issued per column.
grant select, update (locale) on public.buyers to authenticated;
```

Before writing the constraint name, confirm what the existing check on `profiles.locale` is actually called — the `drop constraint if exists` above assumes `profiles_locale_check`, which is Postgres's default name for a column check:

```bash
grep -n "locale" supabase/migrations/20260624000001_id_access_core.sql
```

If the original migration named it explicitly, use that name in the `drop constraint` line instead.

- [ ] **Step 6: Apply and verify the migration locally**

```bash
supabase db reset
```

Expected: all migrations apply cleanly. Then confirm both constraints exist and reject a bad value:

```bash
supabase db test || true
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" \
  -c "update public.profiles set locale = 'de' where true;" 2>&1 | head -3
```

Expected: an error mentioning `profiles_locale_check`.

- [ ] **Step 7: Regenerate the database types**

```bash
npm run db:types
```

Expected: `src/types/database.generated.ts` gains `locale` on the `buyers` row type.

- [ ] **Step 8: Write the server action**

Create `src/lib/i18n/actions.ts`:

```ts
"use server";

import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LOCALE_COOKIE_MAX_AGE, LOCALE_COOKIE_NAME } from "./cookie";
import { isSupportedLocale } from "./locales";

export type SetLocaleResult =
  | { ok: true }
  | { ok: false; messageKey: string };

/**
 * Records the user's language choice.
 *
 * The cookie is the part that always happens — it is what makes the choice
 * survive for signed-out visitors and what next-intl reads when it has to pick
 * a target for a bare-URL redirect. The database write is best-effort on top:
 * it is what carries the choice to a second device and to email.
 *
 * Returns a message key rather than prose so the caller can translate it.
 */
export async function setLocaleAction(locale: string): Promise<SetLocaleResult> {
  if (!isSupportedLocale(locale)) {
    return { ok: false, messageKey: "auth.errors.unexpected" };
  }

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE_NAME, locale, {
    maxAge: LOCALE_COOKIE_MAX_AGE,
    path: "/",
    sameSite: "lax",
  });

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed out is the normal case on the login page. The cookie already did
  // the job, so this is a success, not a failure.
  if (!user) return { ok: true };

  // A person is a buyer or a staff member, never both, but writing both and
  // letting RLS drop the one that does not apply avoids a round trip to find
  // out which. Errors are swallowed on purpose: a failed preference write must
  // not block the language from changing.
  await supabase.from("profiles").update({ locale }).eq("user_id", user.id);
  await supabase.from("buyers").update({ locale }).eq("id", user.id);

  return { ok: true };
}
```

- [ ] **Step 9: Apply the stored preference at sign-in**

This is what makes the choice follow a user to a second device. Without it, the
database column is written but never read, and a user who picked BM on their
phone still lands on English on a new laptop.

Add to `src/lib/i18n/actions.ts`:

```ts
import { resolveLocaleFromSources } from "./cookie";
import { DEFAULT_LOCALE, type AppLocale } from "./locales";

/**
 * Reads the signed-in user's stored locale and writes it to the cookie.
 *
 * Called once at the auth callback, not on every navigation: the cookie is
 * what next-intl consults when it has to choose a prefix, so setting it at the
 * moment a session appears is enough for every later request.
 *
 * The cookie wins over the database when both exist, so a language picked
 * while signed out is not overwritten by a stale stored value.
 */
export async function syncLocaleCookieFromAccount(): Promise<AppLocale> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value ?? null;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return resolveLocaleFromSources({ cookieLocale });

  const [{ data: profile }, { data: buyer }] = await Promise.all([
    supabase.from("profiles").select("locale").eq("user_id", user.id).maybeSingle(),
    supabase.from("buyers").select("locale").eq("id", user.id).maybeSingle(),
  ]);

  const resolved = resolveLocaleFromSources({
    cookieLocale,
    dbLocale: profile?.locale ?? buyer?.locale ?? null,
  });

  if (resolved !== cookieLocale) {
    cookieStore.set(LOCALE_COOKIE_NAME, resolved, {
      maxAge: LOCALE_COOKIE_MAX_AGE,
      path: "/",
      sameSite: "lax",
    });
  }

  return resolved ?? DEFAULT_LOCALE;
}
```

Then call it from `src/app/[locale]/(auth)/auth/callback/route.ts`, after the
session exchange succeeds and before the route builds its redirect. Use the
returned locale as the prefix on that redirect, so the user arrives in their
own language:

```ts
import { syncLocaleCookieFromAccount } from "@/lib/i18n/actions";

// ...after the code exchange, before redirecting:
const locale = await syncLocaleCookieFromAccount();
// then prefix the destination with `/${locale}` rather than sending a bare path
```

Read the existing route first — it already has a destination-building block,
and this replaces how that destination is prefixed rather than adding a second
redirect.

- [ ] **Step 10: Typecheck and run the suite**

```bash
npm run typecheck && npm test
```

Expected: PASS.

- [ ] **Step 11: Verify cross-device persistence by hand**

With `npm run dev` running: sign in, switch to BM, sign out. Then clear the
`NEXT_LOCALE` cookie in devtools (Application → Cookies) and sign in again.
Expected: you land on a `/ms/...` URL, because the stored `profiles.locale`
repopulated the cookie. This is the exact path a second device takes.

- [ ] **Step 12: Commit**

```bash
git add supabase/migrations/20260823000013_i18n_locale.sql src/lib/i18n src/types/database.generated.ts "src/app/[locale]/(auth)/auth/callback/route.ts"
git commit -m "feat(i18n): persist locale choice in cookie and profile/buyer rows"
```

---

### Task 7: The language switcher

**Files:**
- Create: `src/components/shared/locale-switcher.tsx`
- Modify: `src/features/dashboard/components/dashboard-shell-header.tsx`
- Modify: `src/features/buyer/components/buyer-header.tsx`
- Modify: `src/app/[locale]/(auth)/login/page.tsx`
- Modify: `src/app/[locale]/(auth)/signup/page.tsx`
- Modify: `src/app/[locale]/(auth)/mfa/page.tsx`
- Modify: `src/app/[locale]/(auth)/invite/[token]/page.tsx`

**Interfaces:**
- Consumes: `setLocaleAction` (Task 6), `LOCALE_SHORT_LABELS`, `SUPPORTED_LOCALES` (Task 1), `usePathname`/`useRouter` from `src/i18n/navigation.ts` (Task 2).
- Produces: `<LocaleSwitcher />` — no required props.

`DashboardShellHeader` is shared by both the seller layout and the dashboard layout, so mounting there covers both staff shells in one edit.

- [ ] **Step 1: Write the switcher**

Create `src/components/shared/locale-switcher.tsx`. It follows the shape of the existing `ThemeToggle` in the same directory:

```tsx
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
```

- [ ] **Step 2: Mount it in the staff shell header**

In `src/features/dashboard/components/dashboard-shell-header.tsx`, add the import:

```tsx
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
```

and place it immediately before the existing `<ThemeToggle />` in the header's trailing controls:

```tsx
      <LocaleSwitcher />
      <ThemeToggle />
```

- [ ] **Step 3: Mount it in the buyer header**

In `src/features/buyer/components/buyer-header.tsx`, add the import:

```tsx
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
```

and render `<LocaleSwitcher />` in the right-hand control cluster, immediately before the cart button, so it is reachable whether or not the visitor is signed in.

- [ ] **Step 4: Mount it on the four auth pages**

Each of `login/page.tsx`, `signup/page.tsx`, `mfa/page.tsx`, and `invite/[token]/page.tsx` gets the same treatment: import the component and render it in the top-right of the page's card or container, so a visitor can switch before signing in.

```tsx
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
```

```tsx
        <div className="flex justify-end">
          <LocaleSwitcher />
        </div>
```

- [ ] **Step 5: Write the end-to-end spec**

Create `e2e/language-switch.spec.ts`. Follow the fixture and login patterns already used in `e2e/dashboard-shell.spec.ts` and `e2e/_fixtures.ts` rather than inventing a new sign-in helper:

```ts
import { expect, test } from "@playwright/test";

test.describe("language switching", () => {
  test("a bare URL redirects to the English prefix", async ({ page }) => {
    const response = await page.goto("/login");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/en\/login/);
  });

  test("switching to BM changes the URL and the copy", async ({ page }) => {
    await page.goto("/en/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    // The buttons show "EN"/"BM" but carry the full language as their
    // accessible name, so that is what getByRole matches on.
    await page.getByRole("button", { name: "Bahasa Melayu" }).click();

    await expect(page).toHaveURL(/\/ms\/login/);
    await expect(page.getByRole("heading", { name: "Log Masuk" })).toBeVisible();
  });

  test("the choice survives a reload", async ({ page }) => {
    await page.goto("/en/login");
    await page.getByRole("button", { name: "Bahasa Melayu" }).click();
    await expect(page).toHaveURL(/\/ms\/login/);

    // A bare URL now resolves through the cookie, not the default.
    await page.goto("/login");
    await expect(page).toHaveURL(/\/ms\/login/);
  });

  test("switching keeps the user on the same page", async ({ page }) => {
    await page.goto("/en/buyer_portal/ayam-norliza-pilot/login");
    await page.getByRole("button", { name: "Bahasa Melayu" }).click();
    await expect(page).toHaveURL(
      /\/ms\/buyer_portal\/ayam-norliza-pilot\/login/,
    );
  });
});
```

- [ ] **Step 6: Run the spec**

```bash
npx playwright test e2e/language-switch.spec.ts
```

Expected: 4 passed. The second and third tests will fail until Task 8 translates the login page — that is the correct order, so if you are running tasks strictly in sequence, expect those two to go green at the end of Task 8 and only the first and fourth to pass here.

- [ ] **Step 7: Commit**

```bash
git add src/components/shared/locale-switcher.tsx src/features/dashboard src/features/buyer "src/app/[locale]/(auth)" e2e/language-switch.spec.ts
git commit -m "feat(i18n): language switcher on every shell and auth page"
```

---

### Task 8: Translate the shared chrome and the auth pages

Converts hardcoded strings to catalog lookups on the four auth pages and the staff shell header. This is the proof that the whole chain works; the catalogs were written in Task 1 and are used for the first time here.

**Files:**
- Modify: `src/app/[locale]/(auth)/login/page.tsx`
- Modify: `src/app/[locale]/(auth)/signup/page.tsx`
- Modify: `src/app/[locale]/(auth)/mfa/page.tsx`
- Modify: `src/app/[locale]/(auth)/invite/[token]/page.tsx`
- Modify: `src/features/dashboard/components/dashboard-shell-header.tsx`
- Modify: `src/components/shared/theme-toggle.tsx`

**Interfaces:**
- Consumes: `common` and `auth` namespaces from Task 1; `useTranslations` (client components) and `getTranslations` (server components) from next-intl.
- Produces: no new exports.

- [ ] **Step 1: Translate the staff shell header**

`DashboardShellHeader` is a client component, so it uses the hook. Add:

```tsx
import { useTranslations } from "next-intl";
```

Inside the component:

```tsx
  const t = useTranslations("common");
```

Replace the hardcoded workspace line:

```tsx
        <p className="hidden truncate text-xs text-muted-foreground sm:block">
          {t("workspaceSuffix", { section: context.section })}
        </p>
```

That ICU placeholder is the reason `workspaceSuffix` is a template rather than a bare suffix — `"{section} workspace"` and `"Ruang kerja {section}"` put the word in different positions, which string concatenation cannot express.

- [ ] **Step 2: Translate the theme toggle's label**

In `src/components/shared/theme-toggle.tsx`, add `import { useTranslations } from "next-intl";`, add `const t = useTranslations("common");` inside the component, and replace `aria-label="Toggle color theme"` with `aria-label={t("toggleTheme")}`.

- [ ] **Step 3: Translate the auth pages**

For each of the four pages, replace every user-visible literal with a catalog lookup under the matching namespace (`auth.login`, `auth.signup`, `auth.mfa`, `auth.invite`).

In a Server Component:

```tsx
import { getTranslations } from "next-intl/server";

export default async function LoginPage() {
  const t = await getTranslations("auth.login");
  // ... {t("title")}, {t("emailLabel")}, {t("submit")}
}
```

In a Client Component:

```tsx
"use client";
import { useTranslations } from "next-intl";

export function LoginForm() {
  const t = useTranslations("auth.login");
  // ... {t("title")}, {t("emailLabel")}, {t("submit")}
}
```

The invite page interpolates the organization name:

```tsx
{t("subtitle", { organizationName: organization.name })}
```

If a page shows a string that has no key yet, add it to **both** `src/messages/en.json` and `src/messages/ms.json` before using it. The catalog parity test from Task 1 fails the build if only one gets it.

- [ ] **Step 4: Sweep the auth pages for literal navigation**

Within the four auth pages and the two headers, replace `import Link from "next/link"` with `import { Link } from "@/i18n/navigation"`, and replace `useRouter`/`usePathname` imports from `next/navigation` with the versions from `@/i18n/navigation`. Leave `redirect` calls inside Server Actions alone unless they build an auth path — those were handled in Task 5.

Find the remaining offenders across the whole app:

```bash
grep -rn "from \"next/link\"" src/app src/features src/components | wc -l
grep -rn "from \"next/navigation\"" src/app src/features src/components | wc -l
```

Record both counts in the commit message. Converting every one of them is Phase 2–4 work — the un-converted ones still function, they just take a redirect hop. Do not convert files outside this task's file list; a whole-app sweep in this commit would bury the reviewable change.

- [ ] **Step 5: Typecheck, unit test, and build**

```bash
npm run typecheck && npm test && npm run build
```

Expected: PASS. A typo in a message key is a typecheck failure, thanks to the `createMessagesDeclaration` setting from Task 2.

- [ ] **Step 6: Run the full end-to-end suite**

```bash
npm run test:e2e
```

Expected: all specs pass, including the four in `e2e/language-switch.spec.ts`.

The 12 pre-existing specs navigate with bare paths (`page.goto("/ayam-norliza-pilot/customers")`), which the middleware now answers with a 307 to the prefixed URL — Playwright follows redirects, so they keep working. Two things to watch:

- Any spec asserting text on the login page now matches the catalog's English, which is the same copy as before if Step 3 preserved it. If a spec fails on a label, fix the catalog to match the existing copy rather than editing the spec — the copy is what the user already approved.
- `buyer-inline-signup.spec.ts` and `buyer-order.spec.ts` assert BM strings in the buyer portal. The buyer portal is untouched in Phase 1 and still renders hardcoded BM at any prefix, so they should stay green. If one fails, it is a real regression from the route move, not a translation issue.

- [ ] **Step 7: Commit**

```bash
git add "src/app/[locale]/(auth)" src/features/dashboard src/components/shared src/messages
git commit -m "feat(i18n): translate auth pages and shared chrome"
```

---

### Task 9: Glossary and developer documentation

The glossary must exist before Phase 3 drafts BM for operational jargon. Writing it now, while the conventions are fresh, is what keeps four phases of copy consistent.

**Files:**
- Create: `docs/i18n-glossary.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by code.

- [ ] **Step 1: Write the glossary**

Create `docs/i18n-glossary.md`. Fill the BM column with a proposed rendering for every term; these are the entries that need a human decision before Phase 3:

```markdown
# i18n glossary — English ↔ Bahasa Melayu

Fixed renderings for operational vocabulary. Every message catalog must follow
this table. If a term is missing, add it here first, then use it.

Rule of thumb: keep an English term untranslated when the staff already say the
English word out loud on the floor. Translating it "correctly" into a word
nobody uses makes the interface harder to read, not easier.

| English | Bahasa Melayu | Notes |
| --- | --- | --- |
| Order | Pesanan | |
| Customer | Pelanggan | |
| Buyer | Pembeli | The portal account, distinct from Customer. |
| Product | Produk | |
| Delivery | Penghantaran | |
| Dispatch | Penghantaran keluar | Distinct from Delivery; confirm with staff. |
| Run | Trip | Staff say "trip"; "larian" reads as a running race. |
| Zone | Zon | |
| Batch | Kelompok | |
| Coop | Reban | |
| Add-on | Tambahan | |
| Draft | Draf | Order status. |
| Confirmed | Disahkan | Order status. |
| Dispatched | Dihantar | Order status. |
| Delivered | Sampai | Order status. |
| Cancelled | Dibatalkan | Order status. |
| Weight | Berat | |
| Price per kg | Harga sekilo | |
| Invoice | Invois | |
| Settings | Tetapan | |
| Role | Peranan | |
| Sign in / Sign out | Log Masuk / Log Keluar | Already used in the buyer portal. |
```

- [ ] **Step 2: Get the glossary reviewed**

Stop here and have the terms confirmed before Phase 3 begins. The rows most likely to be wrong are Dispatch, Run, Batch, and the order statuses — those are floor vocabulary, and guessing them produces an interface that reads as translated-by-a-stranger.

- [ ] **Step 3: Document the conventions in the README**

Add a section to `README.md`:

```markdown
## Internationalisation

The app ships English (`en`) and Bahasa Melayu (`ms`). Every URL carries a
locale prefix: `/en/...` or `/ms/...`. A bare URL redirects to the visitor's
saved locale, or English if they have none.

- Strings live in `src/messages/en.json` and `src/messages/ms.json`. `en.json`
  is the source of truth; both files must have the same keys, and
  `src/lib/i18n/catalog.test.ts` fails the build if they drift.
- Read them with `useTranslations('namespace')` in client components and
  `await getTranslations('namespace')` in server components. Keys are
  typechecked — a typo fails `npm run typecheck`.
- Import `Link`, `useRouter`, and `usePathname` from `@/i18n/navigation`,
  never from `next/link` or `next/navigation`. The plain versions drop the
  locale prefix and cost a redirect.
- Never concatenate translated strings. Use ICU placeholders:
  `t('workspaceSuffix', {section})`, not `t('workspace') + section`.
- New BM copy follows `docs/i18n-glossary.md`.
- Database values stay English. Only display labels are translated.
```

- [ ] **Step 4: Commit**

```bash
git add docs/i18n-glossary.md README.md
git commit -m "docs(i18n): glossary and developer conventions"
```

---

## Phase 1 exit checklist

Run before opening the merge:

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] `npm run test:e2e` passes, all 15 specs
- [ ] `/en/...` and `/ms/...` both render the seller dashboard, buyer portal, and auth pages
- [ ] A bare URL 307s to the saved locale, or `/en` with no cookie
- [ ] The switcher appears in the staff header, the buyer header, and all four auth pages
- [ ] Switching language keeps the user on the same page
- [ ] The choice survives a reload and a sign-out/sign-in cycle
- [ ] With the cookie cleared, signing in restores the locale from `profiles.locale`
- [ ] HMR still works in `npm run dev`
- [ ] `supabase db reset` applies `20260823000013_i18n_locale.sql` cleanly
- [ ] The glossary has been reviewed by a human

## What Phase 1 deliberately does not do

Stated so a reviewer does not file these as bugs:

- The buyer portal still renders hardcoded Bahasa Melayu at both `/en` and `/ms`. Phase 2.
- The seller dashboard still renders hardcoded English at both prefixes. Phase 3.
- Validation errors, status labels, and emails are untranslated. Phase 4.
- The spec calls for the switcher to be mirrored as a row in profile settings. There is no profile preferences page today — only `profile/security` — so creating one is Phase 4 work, alongside the rest of the dashboard. The header control covers every surface in the meantime, which is the part that matters.
- Most `next/link` imports across the app are unconverted, so those navigations take a redirect hop. Converted per surface in Phases 2–4.
