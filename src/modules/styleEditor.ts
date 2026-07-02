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

type StyleEditorAssetKey = keyof StyleEditorAssets;

type RuntimeAssetDefinition = {
  assetKey: StyleEditorAssetKey;
  sourceFile: string;
  targetSegments: readonly string[];
  commentPrefix?: "//";
  validate?: (path: string, assets: StyleEditorAssets) => Promise<boolean>;
};

const STYLE_EDITOR_ASSET_FILES = {
  defaultCode: "defaultStyle.js",
  itemTypesDTS: "item.d.ts",
  unitTypesDTS: "unit.d.ts",
  styleTypesDTS: "style.d.ts",
  styleUtilsDTS: "styleUtils.d.ts",
  jsConfigText: "jsconfig.json",
  snippetsText: "snippets.jsonc",
  eslintConfigText: "eslint.config.mjs",
  eslintPluginText: "eslint-plugin-banyan-style.mjs",
  eslintStyleUtilsGlobalsText: "eslint-style-utils-globals.mjs",
  packageJSONText: "package.json",
} as const satisfies Record<StyleEditorAssetKey, string>;

const STYLE_EDITOR_RUNTIME_ASSETS: readonly RuntimeAssetDefinition[] = [
  {
    assetKey: "itemTypesDTS",
    sourceFile: "item.d.ts",
    targetSegments: ["item.d.ts"],
    commentPrefix: "//",
  },
  {
    assetKey: "unitTypesDTS",
    sourceFile: "unit.d.ts",
    targetSegments: ["unit.d.ts"],
    commentPrefix: "//",
  },
  {
    assetKey: "styleTypesDTS",
    sourceFile: "style.d.ts",
    targetSegments: ["style.d.ts"],
    commentPrefix: "//",
  },
  {
    assetKey: "styleUtilsDTS",
    sourceFile: "styleUtils.d.ts",
    targetSegments: ["styleUtils.d.ts"],
    commentPrefix: "//",
  },
  {
    assetKey: "jsConfigText",
    sourceFile: "jsconfig.json",
    targetSegments: ["jsconfig.json"],
    validate: hasRuntimeJSConfigContract,
  },
  {
    assetKey: "snippetsText",
    sourceFile: "snippets.jsonc",
    targetSegments: [".vscode", "banyan.code-snippets"],
    commentPrefix: "//",
  },
  {
    assetKey: "eslintConfigText",
    sourceFile: "eslint.config.mjs",
    targetSegments: ["eslint.config.mjs"],
    commentPrefix: "//",
  },
  {
    assetKey: "eslintPluginText",
    sourceFile: "eslint-plugin-banyan-style.mjs",
    targetSegments: ["eslint-plugin-banyan-style.mjs"],
    commentPrefix: "//",
  },
  {
    assetKey: "eslintStyleUtilsGlobalsText",
    sourceFile: "eslint-style-utils-globals.mjs",
    targetSegments: ["eslint-style-utils-globals.mjs"],
    commentPrefix: "//",
  },
  {
    assetKey: "packageJSONText",
    sourceFile: "package.json",
    targetSegments: ["package.json"],
    validate: hasRuntimePackageTypesEntry,
  },
] as const;

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

async function readStyleEditorAsset(fileName: string): Promise<string> {
  return Zotero.File.getContentsFromURLAsync(getStyleEditorAssetURL(fileName));
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
    readStyleEditorAsset(STYLE_EDITOR_ASSET_FILES.defaultCode),
    readStyleEditorAsset(STYLE_EDITOR_ASSET_FILES.itemTypesDTS),
    readStyleEditorAsset(STYLE_EDITOR_ASSET_FILES.unitTypesDTS),
    readStyleEditorAsset(STYLE_EDITOR_ASSET_FILES.styleTypesDTS),
    readStyleEditorAsset(STYLE_EDITOR_ASSET_FILES.styleUtilsDTS),
    readStyleEditorAsset(STYLE_EDITOR_ASSET_FILES.jsConfigText),
    readStyleEditorAsset(STYLE_EDITOR_ASSET_FILES.snippetsText),
    readStyleEditorAsset(STYLE_EDITOR_ASSET_FILES.eslintConfigText),
    readStyleEditorAsset(STYLE_EDITOR_ASSET_FILES.eslintPluginText),
    readStyleEditorAsset(STYLE_EDITOR_ASSET_FILES.eslintStyleUtilsGlobalsText),
    readStyleEditorAsset(STYLE_EDITOR_ASSET_FILES.packageJSONText),
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
  const runtimeAssets = buildRuntimeAssetTargets(banyanDir, assets);

  const current = String(getPref(STYLE_EDITOR_ASSETS_VERSION_PREF) || "");
  const next = String(pluginVersion || "0.0.0");
  const shouldOverwrite =
    __env__ === "development" ||
    isVersionGreater(next, current) ||
    (await hasMissingOrOutdatedRuntimeAssets(runtimeAssets, assets));

  if (!shouldOverwrite) {
    return;
  }

  await ensureRuntimeAssetDirectories(banyanDir, runtimeAssets);
  await Promise.all(
    runtimeAssets.map((asset) => IOUtils.writeUTF8(asset.path, asset.content)),
  );

  setPref(STYLE_EDITOR_ASSETS_VERSION_PREF, next);
}

function buildRuntimeAssetTargets(
  banyanDir: string,
  assets: StyleEditorAssets,
): Array<RuntimeAssetDefinition & { path: string; content: string }> {
  return STYLE_EDITOR_RUNTIME_ASSETS.map((definition) => {
    const content = withManagedFileComment(
      assets[definition.assetKey],
      definition.commentPrefix,
      definition.sourceFile,
    );
    return {
      ...definition,
      path: PathUtils.join(banyanDir, ...definition.targetSegments),
      content,
    };
  });
}

function withManagedFileComment(
  content: string,
  commentPrefix: RuntimeAssetDefinition["commentPrefix"],
  sourceFile: string,
): string {
  if (!commentPrefix) {
    return content;
  }

  const header = [
    `${commentPrefix} This file is managed by Banyan style editor runtime assets.`,
    `${commentPrefix} Source asset: addon/content/styleEditor/${sourceFile}`,
    `${commentPrefix} Local edits may be overwritten on Banyan updates or in development mode.`,
    "",
  ].join("\n");

  return `${header}${content.replace(/^\s+/, "")}`;
}

async function ensureRuntimeAssetDirectories(
  banyanDir: string,
  runtimeAssets: ReadonlyArray<{ path: string }>,
): Promise<void> {
  const directories = new Set<string>([banyanDir]);
  for (const asset of runtimeAssets) {
    const parent = PathUtils.parent(asset.path);
    if (parent) {
      directories.add(parent);
    }
  }

  await Promise.all(
    Array.from(directories).map((directory) =>
      IOUtils.makeDirectory(directory, {
        createAncestors: true,
        ignoreExisting: true,
      }),
    ),
  );
}

async function hasMissingOrOutdatedRuntimeAssets(
  runtimeAssets: ReadonlyArray<RuntimeAssetDefinition & { path: string }>,
  assets: StyleEditorAssets,
): Promise<boolean> {
  for (const asset of runtimeAssets) {
    if (!(await IOUtils.exists(asset.path))) {
      return true;
    }
    if (asset.validate && !(await asset.validate(asset.path, assets))) {
      return true;
    }
  }
  return false;
}

async function hasRuntimePackageTypesEntry(path: string): Promise<boolean> {
  const text = await IOUtils.readUTF8(path).catch(() => "");
  return text.includes('"types"') && text.includes("style.d.ts");
}

async function hasRuntimeJSConfigContract(
  path: string,
  assets: StyleEditorAssets,
): Promise<boolean> {
  const text = await IOUtils.readUTF8(path).catch(() => "");
  return (
    text.includes('"./*.js"') &&
    text.includes('"./*.d.ts"') &&
    hasMatchingStyleEditorJSCompilerOptions(text, assets.jsConfigText)
  );
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
