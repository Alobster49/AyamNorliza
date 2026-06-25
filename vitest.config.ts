import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(here, "./src"),
    },
  },
  test: {
    environment: "node",
    include: [
      "src/features/**/tests/unit/**/*.test.ts",
      "src/lib/**/*.test.ts",
    ],
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      reporter: ["text", "lcov"],
      include: [
        "src/lib/**/*.ts",
        "src/features/**/*.ts",
      ],
    },
  },
});
