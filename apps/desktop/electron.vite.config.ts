import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@grabber/core"] })],
    resolve: {
      alias: {
        "@grabber/core": resolve(__dirname, "../../packages/core/src"),
      },
    },
    build: {
      outDir: "out/main",
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["@grabber/core"] })],
    resolve: {
      alias: {
        "@grabber/core": resolve(__dirname, "../../packages/core/src"),
      },
    },
    build: {
      outDir: "out/preload",
    },
  },
  renderer: {
    root: "src/renderer",
    plugins: [react()],
    resolve: {
      alias: {
        "@grabber/core": resolve(__dirname, "../../packages/core/src"),
      },
    },
    build: {
      outDir: "out/renderer",
    },
  },
});
