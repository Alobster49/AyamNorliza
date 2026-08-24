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
      "src/features/orders/components/**/*.{ts,tsx}",
      "src/features/logistics/components/**/*.{ts,tsx}",
      "src/features/overview/components/**/*.{ts,tsx}",
      // Individually listed, not the `src/components/forms/**` directory -
      // `login-form.tsx` and `mfa-enroll-card.tsx` are fully converted, so a
      // directory glob would exempt them wholesale and hide a regression.
      "src/components/forms/update-organization-form.tsx",
      "src/components/forms/invite-user-dialog.tsx",
      "src/components/forms/break-glass-dialog.tsx",
      "src/components/forms/reauth-dialog.tsx",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    // These three shells have already converted `usePathname` to the
    // locale-aware import - only `Link` and `useRouter` still come from
    // `next/link` / `next/navigation` directly. A wholesale exemption (as
    // above) would leave the converted `usePathname` unguarded against
    // regressing back to `next/navigation`, so this override keeps that one
    // import name restricted while permitting the rest.
    files: [
      "src/features/dashboard/components/app-sidebar.tsx",
      "src/features/seller/components/seller-sidebar.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/navigation",
              importNames: ["usePathname"],
              message: "Import `usePathname` from `@/i18n/navigation` instead - the `next/navigation` version drops the locale prefix.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
