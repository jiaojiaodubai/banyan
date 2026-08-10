import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  updateURL: `https://github.com/{{owner}}/{{repo}}/releases/download/release/${
    pkg.version.includes("-") ? "update-beta.json" : "update.json"
  }`,
  xpiDownloadLink:
    "https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/{{xpiName}}.xpi",

  build: {
    assets: [
      "addon/**/*.*",
      "typings/item.d.ts",
      "typings/style.d.ts",
      "typings/styleUtils.d.ts",
    ],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    prefs: {
      prefix: pkg.config.prefsPrefix,
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        target: "firefox115",
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}.js`,
      },
      // Build dialog window scripts (exclude development-only helpers)
      {
        entryPoints: [
          { in: "src/dialogs/styleDialog.ts", out: "styleDialog" },
          { in: "src/dialogs/styleEditor/index.ts", out: "styleEditor" },
          { in: "src/dialogs/citationDialog.ts", out: "citationDialog" },
          {
            in: "src/dialogs/bibliographyDialog.ts",
            out: "bibliographyDialog",
          },
          {
            in: "src/dialogs/createOutputDialog.ts",
            out: "createOutputDialog",
          },
          {
            in: "src/dialogs/extraFieldDialog.ts",
            out: "extraFieldDialog",
          },
        ],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        target: "firefox115",
        outdir: ".scaffold/build/addon/content/scripts",
        entryNames: "[name]",
      },
    ],
  },

  test: {
    waitForPlugin: `() => Zotero.${pkg.config.addonInstance}.data.initialized`,
  },

  // If you need to see a more detailed log, uncomment the following line:
  // logLevel: "trace",
});
