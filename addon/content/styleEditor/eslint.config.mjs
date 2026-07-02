import js from "@eslint/js";
import banyanStyle from "./eslint-plugin-banyan-style.mjs";
import { extractStyleUtilsReadonlyGlobals } from "./eslint-style-utils-globals.mjs";

const styleUtilsGlobals = extractStyleUtilsReadonlyGlobals();

export default [
  js.configs.recommended,
  {
    files: ["**/*.js"],
    ignores: ["**/snippets/**/*.js"],
    plugins: {
      banyanStyle,
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        contexts: "readonly",
        ...styleUtilsGlobals,
      },
    },
    rules: {
      indent: ["warn", 2],
      "no-var": "warn",
      eqeqeq: ["warn", "always"],
      semi: ["warn", "always"],
      // Entry globals (INFO/UI/gen*) are consumed by sandbox loader, not local references.
      "no-unused-vars": "off",
      "banyanStyle/require-style-contract": "error",
      "banyanStyle/warn-risky-runtime-pattern": "warn",
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
