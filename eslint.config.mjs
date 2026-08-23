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
    // Bilingual UI guard rail: `Link`/`useRouter`/`usePathname` must come
    // from `@/i18n/navigation`, never from `next/link` / `next/navigation`
    // directly, or the locale prefix gets dropped and every navigation
    // costs an extra redirect (see README "Internationalisation").
    //
    // Applied to the whole tree (`src/**`) rather than an allowlist of
    // converted subtrees: an allowlist only ever flags files already known
    // to be clean, so it can never catch a regression in a file it doesn't
    // list, and every Phase 2+ surface (src/features/**, src/components/**)
    // sat outside it entirely. The block below turns the rule back `off`
    // for the areas still carrying real, pre-existing bare-path usage.
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
              importNames: ["useRouter", "usePathname"],
              message: "Import `useRouter`/`usePathname` from `@/i18n/navigation` instead - the `next/navigation` versions drop the locale prefix.",
            },
          ],
        },
      ],
    },
  },
  {
    // Legacy surfaces not yet converted to the locale-aware imports above.
    // Each entry here is deleted as Phase 2+ converts that surface - do not
    // add new files to this list; convert them instead.
    //
    // `[locale]` must be escaped (`\\[locale\\]`) - minimatch treats an
    // unescaped `[...]` as a character class, so an un-escaped pattern here
    // never matches any file at all. That bug is also why the original
    // (pre-this-change) version of this rule's `files` list - which used
    // the same unescaped `[locale]`/`[organizationSlug]` glob syntax -
    // matched nothing, not just the files it happened to list: the rule was
    // vacuous for every path, not only the ones its comment described.
    files: [
      "src/app/\\[locale\\]/(seller)/**/*.{ts,tsx}",
      "src/app/\\[locale\\]/buyer_portal/**/*.{ts,tsx}",
      "src/features/orders/components/**/*.{ts,tsx}",
      "src/features/identity-access/components/**/*.{ts,tsx}",
      "src/features/logistics/components/**/*.{ts,tsx}",
      "src/features/overview/components/**/*.{ts,tsx}",
      "src/components/forms/**/*.{ts,tsx}",
      // These four were reported as fully converted by an earlier wave, but
      // re-running lint against `src/**` (rather than trusting that claim)
      // shows only `login-form.tsx` (covered by the `src/components/forms/**`
      // entry above) actually is - the other three still import `Link`
      // and/or `useRouter` from `next/link` / `next/navigation` directly.
      // Listed individually, not as a directory glob, so the exemption
      // stays exactly as wide as what's actually unconverted.
      "src/features/dashboard/components/app-sidebar.tsx",
      "src/features/seller/components/seller-sidebar.tsx",
      "src/features/buyer/components/buyer-header.tsx",
      "src/features/buyer/components/cart-overlay.tsx",
      "src/features/buyer/components/cart-view.tsx",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];

export default eslintConfig;
