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
    // Scoped to `src/app/[locale]/**` only, and further limited to the
    // subtrees Phase 1 already converted - (auth), (dashboard), drive, the
    // root locale layout/page, and the bare-slug redirect page. `(seller)`
    // and `buyer_portal` still have real, pre-existing bare-path usage
    // (~40 call sites, tracked for Phases 2-4) and are deliberately left
    // out here so this rule guards new work without turning the current
    // tree red. Widen the `files` list as each subtree is converted.
    files: [
      "src/app/[locale]/layout.tsx",
      "src/app/[locale]/page.tsx",
      "src/app/[locale]/(auth)/**/*.{ts,tsx}",
      "src/app/[locale]/(dashboard)/**/*.{ts,tsx}",
      "src/app/[locale]/drive/**/*.{ts,tsx}",
      "src/app/[locale]/[organizationSlug]/**/*.{ts,tsx}",
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
