import { useL10n } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import { version as pluginVersion } from "../../package.json";

const t = useL10n(["styleEditor.ftl"]);

const STYLE_EDITOR_ASSETS_VERSION_PREF = "styleEditorAssetsVersion";
const STYLE_EDITOR_SHARED_COMPILER_OPTION_KEYS = [
  "allowJs",
  "checkJs",
  "noEmit",
  "target",
  "module",
  "moduleDetection",
  "lib",
] as const;

export type StyleEditorAssets = {
  defaultCode: string;
  itemTypesDTS: string;
  unitTypesDTS: string;
  styleTypesDTS: string;
  styleUtilsDTS: string;
  jsConfigText: string;
  snippetsText: string;
  eslintConfigText: string;
  eslintPluginText: string;
  eslintStyleUtilsGlobalsText: string;
  packageJSONText: string;
};

let cachedAssets: StyleEditorAssets | null = null;

export function parseStyleEditorJSCompilerOptions(
  jsConfigText: string,
): Record<string, unknown> {
  try {
    const parsed = JSON.parse(jsConfigText) as {
      compilerOptions?: unknown;
    };
    if (!parsed.compilerOptions || typeof parsed.compilerOptions !== "object") {
      return {};
    }
    return parsed.compilerOptions as Record<string, unknown>;
  } catch {
    return {};
  }
}

function normalizeCompilerOptionForComparison(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      typeof entry === "string" ? entry.toLowerCase() : entry,
    );
  }
  if (typeof value === "string") {
    return value.toLowerCase();
  }
  return value;
}

function hasMatchingStyleEditorJSCompilerOptions(
  currentText: string,
  expectedText: string,
): boolean {
  const current = parseStyleEditorJSCompilerOptions(currentText);
  const expected = parseStyleEditorJSCompilerOptions(expectedText);

  return STYLE_EDITOR_SHARED_COMPILER_OPTION_KEYS.every((key) => {
    const currentValue = normalizeCompilerOptionForComparison(current[key]);
    const expectedValue = normalizeCompilerOptionForComparison(expected[key]);
    return JSON.stringify(currentValue) === JSON.stringify(expectedValue);
  });
}

function getStyleEditorAssetURL(fileName: string): string {
  return `chrome://${addon.data.config.addonRef}/content/styleEditor/${fileName}`;
}

export async function getStyleEditorAssets(): Promise<StyleEditorAssets> {
  if (cachedAssets) {
    return cachedAssets;
  }

  const [
    defaultCode,
    itemTypesDTS,
    unitTypesDTS,
    styleTypesDTS,
    styleUtilsDTS,
    jsConfigText,
    snippetsText,
    eslintConfigText,
    eslintPluginText,
    eslintStyleUtilsGlobalsText,
    packageJSONText,
  ] = await Promise.all([
    Zotero.File.getContentsFromURLAsync(
      getStyleEditorAssetURL("defaultStyle.js"),
    ),
    Zotero.File.getContentsFromURLAsync(getStyleEditorAssetURL("item.d.ts")),
    Zotero.File.getContentsFromURLAsync(getStyleEditorAssetURL("unit.d.ts")),
    Zotero.File.getContentsFromURLAsync(getStyleEditorAssetURL("style.d.ts")),
    Zotero.File.getContentsFromURLAsync(
      getStyleEditorAssetURL("styleUtils.d.ts"),
    ),
    Zotero.File.getContentsFromURLAsync(
      getStyleEditorAssetURL("jsconfig.json"),
    ),
    Zotero.File.getContentsFromURLAsync(
      getStyleEditorAssetURL("snippets.jsonc"),
    ),
    Zotero.File.getContentsFromURLAsync(
      getStyleEditorAssetURL("eslint.config.mjs"),
    ),
    Zotero.File.getContentsFromURLAsync(
      getStyleEditorAssetURL("eslint-plugin-banyan-style.mjs"),
    ),
    Zotero.File.getContentsFromURLAsync(
      getStyleEditorAssetURL("eslint-style-utils-globals.mjs"),
    ),
    Zotero.File.getContentsFromURLAsync(getStyleEditorAssetURL("package.json")),
  ]);

  cachedAssets = {
    defaultCode,
    itemTypesDTS,
    unitTypesDTS,
    styleTypesDTS,
    styleUtilsDTS,
    jsConfigText,
    snippetsText,
    eslintConfigText,
    eslintPluginText,
    eslintStyleUtilsGlobalsText,
    packageJSONText,
  };
  return cachedAssets;
}

export async function ensureStyleEditorRuntimeAssets(): Promise<void> {
  const assets = await getStyleEditorAssets();
  const banyanDir = PathUtils.join(Zotero.DataDirectory.dir, "banyan");

  const runtimeItemPath = PathUtils.join(banyanDir, "item.d.ts");
  const runtimeUnitPath = PathUtils.join(banyanDir, "unit.d.ts");
  const runtimeStylePath = PathUtils.join(banyanDir, "style.d.ts");
  const runtimeStyleUtilsPath = PathUtils.join(banyanDir, "styleUtils.d.ts");
  const runtimeJSConfigPath = PathUtils.join(banyanDir, "jsconfig.json");
  const runtimeVSCodeDir = PathUtils.join(banyanDir, ".vscode");
  const runtimeVSCodeSnippetsPath = PathUtils.join(
    runtimeVSCodeDir,
    "banyan.code-snippets",
  );
  const runtimeESLintPath = PathUtils.join(banyanDir, "eslint.config.mjs");
  const runtimeESLintPluginPath = PathUtils.join(
    banyanDir,
    "eslint-plugin-banyan-style.mjs",
  );
  const runtimeESLintGlobalsPath = PathUtils.join(
    banyanDir,
    "eslint-style-utils-globals.mjs",
  );
  const runtimePackageJSONPath = PathUtils.join(banyanDir, "package.json");

  const hasItemTypes = await IOUtils.exists(runtimeItemPath);
  const hasUnitTypes = await IOUtils.exists(runtimeUnitPath);
  const hasStyleTypes = await IOUtils.exists(runtimeStylePath);
  const hasStyleUtils = await IOUtils.exists(runtimeStyleUtilsPath);
  const hasRuntimeJSConfig = await IOUtils.exists(runtimeJSConfigPath);
  const hasRuntimeVSCodeSnippets = await IOUtils.exists(
    runtimeVSCodeSnippetsPath,
  );
  const hasESLint = await IOUtils.exists(runtimeESLintPath);
  const hasESLintPlugin = await IOUtils.exists(runtimeESLintPluginPath);
  const hasESLintGlobals = await IOUtils.exists(runtimeESLintGlobalsPath);
  const hasRuntimePackageJSON = await IOUtils.exists(runtimePackageJSONPath);

  const runtimePackageJSONText = hasRuntimePackageJSON
    ? await IOUtils.readUTF8(runtimePackageJSONPath).catch(() => "")
    : "";
  const hasRuntimeTypesEntry =
    runtimePackageJSONText.includes('"types"') &&
    runtimePackageJSONText.includes("style.d.ts");

  const runtimeJSConfigText = hasRuntimeJSConfig
    ? await IOUtils.readUTF8(runtimeJSConfigPath).catch(() => "")
    : "";
  const hasRuntimeJSConfigIncludes =
    runtimeJSConfigText.includes('"./*.js"') &&
    runtimeJSConfigText.includes('"./*.d.ts"');
  const hasRuntimeJSConfigCompilerOptions =
    hasRuntimeJSConfig &&
    hasMatchingStyleEditorJSCompilerOptions(
      runtimeJSConfigText,
      assets.jsConfigText,
    );

  const current = String(getPref(STYLE_EDITOR_ASSETS_VERSION_PREF) || "");
  const next = String(pluginVersion || "0.0.0");
  const shouldOverwrite =
    !hasItemTypes ||
    !hasUnitTypes ||
    !hasStyleTypes ||
    !hasStyleUtils ||
    !hasRuntimeJSConfig ||
    !hasRuntimeJSConfigIncludes ||
    !hasRuntimeJSConfigCompilerOptions ||
    !hasRuntimeVSCodeSnippets ||
    !hasESLint ||
    !hasESLintPlugin ||
    !hasESLintGlobals ||
    !hasRuntimePackageJSON ||
    !hasRuntimeTypesEntry ||
    isVersionGreater(next, current);
  if (!shouldOverwrite) {
    return;
  }

  await IOUtils.makeDirectory(banyanDir, {
    createAncestors: true,
    ignoreExisting: true,
  });
  await IOUtils.makeDirectory(runtimeVSCodeDir, {
    createAncestors: true,
    ignoreExisting: true,
  });

  await Promise.all([
    IOUtils.writeUTF8(runtimeItemPath, assets.itemTypesDTS),
    IOUtils.writeUTF8(runtimeUnitPath, assets.unitTypesDTS),
    IOUtils.writeUTF8(runtimeStylePath, assets.styleTypesDTS),
    IOUtils.writeUTF8(runtimeStyleUtilsPath, assets.styleUtilsDTS),
    IOUtils.writeUTF8(runtimeJSConfigPath, assets.jsConfigText),
    IOUtils.writeUTF8(runtimeVSCodeSnippetsPath, assets.snippetsText),
    IOUtils.writeUTF8(runtimeESLintPath, assets.eslintConfigText),
    IOUtils.writeUTF8(runtimeESLintPluginPath, assets.eslintPluginText),
    IOUtils.writeUTF8(
      runtimeESLintGlobalsPath,
      assets.eslintStyleUtilsGlobalsText,
    ),
    IOUtils.writeUTF8(runtimePackageJSONPath, assets.packageJSONText),
  ]);

  setPref(STYLE_EDITOR_ASSETS_VERSION_PREF, next);
}

function isVersionGreater(next: string, current: string): boolean {
  if (!current) return true;
  const nextParts = parseSemver(next);
  const currentParts = parseSemver(current);
  for (let i = 0; i < 3; i++) {
    if (nextParts[i] > currentParts[i]) return true;
    if (nextParts[i] < currentParts[i]) return false;
  }
  return false;
}

function parseSemver(version: string): [number, number, number] {
  const match = String(version)
    .trim()
    .match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return [0, 0, 0];
  return [
    Number.parseInt(match[1], 10) || 0,
    Number.parseInt(match[2], 10) || 0,
    Number.parseInt(match[3], 10) || 0,
  ];
}

export function openStyleEditorWindow(): void {
  try {
    const win = Services.ww.openWindow(
      // @ts-expect-error Services.ww.openWindow has incomplete type definitions
      null,
      `chrome://${addon.data.config.addonRef}/content/styleEditor/styleEditor.xhtml`,
      "banyan-style-editor",
      "chrome,resizable,centerscreen",
      null,
    );
    // @ts-expect-error activate is not typed
    Zotero.Utilities.Internal.activate(win);
  } catch (e) {
    ztoolkit.logError(e);
    ztoolkit.getGlobal("alert")(
      `${t("style-editor-error-prefix")}: ${String(e)}`,
    );
  }
}
