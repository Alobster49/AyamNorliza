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
];

export default eslintConfig;
