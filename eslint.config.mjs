import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/out/**",
      "**/release/**",
      "**/coverage/**",
      "**/*.config.{js,mjs,cjs,ts}",
      "scripts/**",
      "**/scripts/**",
      // Browser-extension MV3 (plain JS, chrome.* globals, no TS project).
      "extension/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },
  {
    files: ["packages/core/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "electron",
              message: "core must not import Electron. Talk to DownloadEngine only.",
            },
            {
              name: "node:child_process",
              message: "core must not import Node. Talk to DownloadEngine only.",
            },
            {
              name: "node:fs",
              message: "core must not import Node. Talk to DownloadEngine only.",
            },
            {
              name: "node:path",
              message: "core must not import Node. Talk to DownloadEngine only.",
            },
            {
              name: "node:os",
              message: "core must not import Node. Talk to DownloadEngine only.",
            },
          ],
          patterns: [
            {
              group: ["electron", "electron/*", "node:*", "vite", "vite/*"],
              message: "core must not import Electron/Node. Talk to DownloadEngine only.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
);
