import js from "@eslint/js";
import { createBanyanStyleConfig } from "./eslint-plugin-banyan-style.mjs";

const banyan = createBanyanStyleConfig();

export default [
  js.configs.recommended,
  {
    ...banyan,
    ignores: ["**/snippets/**/*.js"],
    rules: {
      ...banyan.rules,
      indent: ["warn", 2],
      "no-var": "warn",
      eqeqeq: ["warn", "always"],
      semi: ["warn", "always"],
    },
  },
  {
    files: ["**/snippets/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
    },
    rules: {
      indent: ["warn", 2],
      "no-var": "warn",
      eqeqeq: ["warn", "always"],
      semi: ["warn", "always"],
      "no-unused-vars": "off",
      "banyanStyle/require-style-contract": "off",
    },
  },
];
