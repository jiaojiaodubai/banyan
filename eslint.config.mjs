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
    ],
  },
];
