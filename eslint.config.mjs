// @ts-check Let TS check this config file

import zotero from "@zotero-plugin/eslint-config";

const base = zotero({
  overrides: [
    {
      files: ["**/*.ts"],
    },
  ],
});

export default [
  ...base,
  {
    ignores: [
      "scripts/**",
      "integrations/**",
      "addon/content/styleEditor/**",
      "addon/content/integration/WPS/**",
      // Style fixtures run inside the Banyan sandbox, which injects their
      // globals and style constants; they are checked when the style loads.
      "test-gui/styles/**",
    ],
  },
  {
    // Logging goes through the scoped logger, so every line carries its module
    // and its level. `src/utils/logger.ts` owns the output channels, so it is
    // the only file allowed to write to Zotero directly.
    files: ["src/**/*.ts"],
    ignores: ["src/utils/logger.ts"],
    rules: {
      "no-console": "error",
      "no-restricted-properties": [
        "error",
        {
          object: "ztoolkit",
          property: "log",
          message: "Use `createLogger()` from src/utils/logger instead.",
        },
        {
          object: "ztoolkit",
          property: "logError",
          message: "Use `createLogger()` from src/utils/logger instead.",
        },
      ],
    },
  },
];
