import { defineConfig } from "@playwright/test";

// Electron smoke tests only (no browsers needed). Run after a build:
//   pnpm --filter @grabber/desktop build && pnpm --filter @grabber/desktop test:e2e
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 120_000,
  reporter: "list",
});
