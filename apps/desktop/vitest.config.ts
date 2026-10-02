import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Mirrors the electron-vite alias so deep `@grabber/core/*.js` imports
// resolve to TypeScript sources under vitest (node, no bundler).
export default defineConfig({
  resolve: {
    alias: {
      "@grabber/core": resolve(__dirname, "../../packages/core/src"),
    },
  },
});
