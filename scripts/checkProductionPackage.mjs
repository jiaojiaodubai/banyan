import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function validateProductionArchive(zip, config, editorAssets, locales) {
  const names = new Set();
  for (const entry of zip.getEntries()) {
    if (names.has(entry.entryName))
      throw new Error(`Duplicate XPI entry: ${entry.entryName}`);
    names.add(entry.entryName);
  }
  const readRequired = (name) => {
    const entry = zip.getEntry(name);
    if (!entry || entry.isDirectory)
      throw new Error(`Missing XPI resource: ${name}`);
    const content = entry.getData();
    if (
      !content.length ||
      (/\.(?:css|ftl|html|js|jsonc?|mjs|svg|ts|txt|xml|xhtml)$/i.test(name) &&
        !content.toString("utf8").trim())
    ) {
      throw new Error(`Empty XPI resource: ${name}`);
    }
    return content;
  };
  const readJSON = (name) => {
    try {
      return JSON.parse(readRequired(name).toString("utf8"));
    } catch (error) {
      throw new Error(`Invalid XPI JSON resource: ${name}: ${error.message}`);
    }
  };
  const safeRelative = (value) =>
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((part) => part && part !== "." && part !== "..");
  const manifest = readJSON("manifest.json");
  if (
    manifest.applications?.zotero?.id !== config.addonID ||
    manifest.version !== config.version
  ) {
    throw new Error("XPI manifest ID or version does not match package.json");
  }
  for (const name of [
    "bootstrap.js",
    `content/scripts/${config.addonRef}.js`,
    "content/icons/favicon.svg",
    "content/integration/Word/Banyan.dotm",
  ])
    readRequired(name);
  for (const file of Object.values(editorAssets)) {
    if (!safeRelative(file))
      throw new Error(`Invalid style editor resource path: ${file}`);
    readRequired(`content/styleEditor/${file}`);
  }
  if (!locales.length) throw new Error("No Fluent source resources found");
  for (const locale of locales) readRequired(`locale/${locale}`);
  const presets = readJSON("content/styleEditor/presets/presets-manifest.json");
  if (!Array.isArray(presets) || !presets.length)
    throw new Error("Preset manifest is empty or invalid");
  for (const file of presets) {
    if (!safeRelative(file)) throw new Error(`Invalid preset path: ${file}`);
    readRequired(`content/styleEditor/presets/${file}`);
  }
  const wps = readJSON("content/integration/WPS/addin-manifest.json");
  if (
    !safeRelative(wps.resourceRoot) ||
    !wps.resourceRoot.startsWith("integration/WPS/") ||
    !Array.isArray(wps.files) ||
    !wps.files.length
  ) {
    throw new Error("WPS integration manifest is invalid");
  }
  for (const file of wps.files) {
    if (!safeRelative(file))
      throw new Error(`Invalid WPS resource path: ${file}`);
    readRequired(`content/${wps.resourceRoot}/${file}`);
  }
}

export async function checkProductionPackage(packagePath) {
  const pkg = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  const editorAssets = JSON.parse(
    await readFile(
      path.join(root, "src/utils/styleEditorAssetFiles.json"),
      "utf8",
    ),
  );
  const localeRoot = path.join(root, "addon/locale");
  const locales = [];
  for (const locale of await readdir(localeRoot, { withFileTypes: true })) {
    if (!locale.isDirectory()) continue;
    for (const name of await readdir(path.join(localeRoot, locale.name))) {
      if (name.endsWith(".ftl"))
        locales.push(`${locale.name}/${pkg.config.addonRef}-${name}`);
    }
  }
  const xpi = path.resolve(
    packagePath ||
      path.join(root, ".scaffold/build", `${pkg.config.addonRef}.xpi`),
  );
  validateProductionArchive(
    new AdmZip(xpi),
    { ...pkg.config, version: pkg.version },
    editorAssets,
    locales,
  );
  return xpi;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  checkProductionPackage(process.argv[2] || process.env.BANYAN_PROD_XPI)
    .then((xpi) =>
      process.stdout.write(`Production package resources verified: ${xpi}\n`),
    )
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
