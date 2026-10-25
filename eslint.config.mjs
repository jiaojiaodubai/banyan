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
];
