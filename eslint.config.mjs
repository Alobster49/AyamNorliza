import nextConfig from "eslint-config-next";

/** @type {import('eslint').Linter.FlatConfig[]} */
const eslintConfig = [
  ...nextConfig,
  {
    rules: {
      "@next/next/no-html-link-for-pages": "off",
    },
    ignores: [
      "node_modules/",
      ".next/",
      "src/types/database.generated.ts",
    ],
  },
  {
    // Bilingual UI guard rail: `Link`/`useRouter`/`usePathname`/`redirect`
    // must come from `@/i18n/navigation`, never from `next/link` /
    // `next/navigation` directly, or the locale prefix gets dropped and
    // every navigation costs an extra redirect (see README
    // "Internationalisation"). Applied to the whole tree - every surface is
    // converted as of Phase 3, so there is no remaining allowlist/denylist
    // to maintain here; the two overrides below cover the small number of
    // sites that legitimately build an explicit `/${locale}/...` path
    // themselves and so have no locale-prefix bug to guard against.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/link",
              message: "Import `Link` from `@/i18n/navigation` instead - it carries the locale prefix.",
            },
            {
              name: "next/navigation",
              importNames: ["useRouter", "usePathname", "redirect"],
              message: "Import `useRouter`/`usePathname`/`redirect` from `@/i18n/navigation` instead - the `next/navigation` versions drop the locale prefix.",
            },
          ],
        },
      ],
    },
  },
  {
    // These sites build the destination path themselves as
    // `/${locale}/...` (via `getLocale()`/`next-intl/server`, or a `locale`
    // route param already in scope) before calling `redirect()`, so the
    // `next/navigation` version's missing locale prefix is not a bug here -
    // it's the point. Using `@/i18n/navigation`'s `redirect()` instead would
    // double-prefix the locale, and - for `guards.ts`/`buyer-auth.ts`,
    // reachable from Vitest unit tests - `@/i18n/navigation`'s
    // client-navigation build fails to resolve `next/navigation` under
    // Vitest's node environment at all. Kept as a narrow per-file exemption
    // rather than folding into the base rule so a regression to a *bare*
    // path in these same files is still caught.
    files: [
      "src/app/\\[locale\\]/(seller)/\\[organizationSlug\\]/layout.tsx",
      "src/app/\\[locale\\]/(dashboard)/\\[organizationSlug\\]/layout.tsx",
      "src/app/\\[locale\\]/(auth)/invite/\\[token\\]/page.tsx",
      "src/lib/auth/require-user.ts",
      "src/lib/auth/buyer-auth.ts",
      "src/features/orders/server/guards.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/link",
              message: "Import `Link` from `@/i18n/navigation` instead - it carries the locale prefix.",
            },
            {
              name: "next/navigation",
              importNames: ["useRouter", "usePathname"],
              message: "Import `useRouter`/`usePathname` from `@/i18n/navigation` instead - the `next/navigation` versions drop the locale prefix.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
