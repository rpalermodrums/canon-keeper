import path from "node:path";
import { fileURLToPath } from "node:url";

import js from "@eslint/js";
import tsEslintPlugin from "@typescript-eslint/eslint-plugin";
import tsEslintParser from "@typescript-eslint/parser";
import globals from "globals";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import reactPlugin from "eslint-plugin-react";

const tsconfigRootDir = path.dirname(fileURLToPath(import.meta.url));
const sharedGlobals = {
  ...globals.browser,
  ...globals.node,
  ...globals.es2022
};

export default [
  {
    linterOptions: {
      reportUnusedDisableDirectives: "off"
    }
  },
  {
    ignores: ["node_modules", "**/dist", "**/dist-*", "**/build", "**/.vite"]
  },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      parser: tsEslintParser,
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir,
        sourceType: "module"
      },
      globals: sharedGlobals
    },
    plugins: {
      "@typescript-eslint": tsEslintPlugin,
      react: reactPlugin,
      "react-hooks": reactHooksPlugin
    },
    settings: {
      react: { version: "detect" }
    },
    rules: {
      ...tsEslintPlugin.configs.recommended.rules,
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      "no-undef": "off",
      "react/react-in-jsx-scope": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": "warn"
    }
  },
  {
    files: ["**/*.{js,cjs,mjs,jsx}"],
    languageOptions: {
      globals: sharedGlobals
    }
  }
];
