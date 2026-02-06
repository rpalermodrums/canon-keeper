import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/*.{test,spec}.ts", "apps/**/*.{test,spec}.tsx", "packages/**/*.{test,spec}.ts"],
    environment: "node",
    globalSetup: ["apps/desktop/electron/worker/testPreflight.ts"]
  }
});
