import { defineConfig } from "vitest/config";

// Tests import from the compiled dist/ (built by the `pretest` step) so they
// exercise the exact shipped artifact and avoid TS/ESM .js-specifier resolution
// quirks.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
