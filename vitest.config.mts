import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    dedupe: ["react", "react-dom"]
  },
  test: {
    include: [
      "apps/**/*.{test,spec}.ts",
      "apps/**/*.{test,spec}.tsx",
      "packages/**/*.{test,spec}.ts"
    ],
    environment: "node",
    globalSetup: ["apps/desktop/electron/worker/testPreflight.ts"],
    coverage: {
      provider: "v8",
      include: [
        "apps/desktop/electron/worker/**/*.ts",
        "apps/desktop/renderer/src/state/**/*.ts",
        "apps/desktop/renderer/src/api/**/*.ts",
        "apps/desktop/renderer/src/views/**/*.ts",
        "apps/desktop/renderer/src/views/**/*.tsx",
        "apps/desktop/renderer/src/components/**/*.ts",
        "apps/desktop/renderer/src/components/**/*.tsx",
        "apps/desktop/renderer/src/context*/**/*.ts",
        "apps/desktop/renderer/src/context*/**/*.tsx",
        "packages/shared/**/*.ts"
      ],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "**/*.d.ts", "**/testPreflight.ts"],
      thresholds: {
        statements: 55,
        branches: 70,
        functions: 80,
        lines: 55
      }
    }
  }
});
