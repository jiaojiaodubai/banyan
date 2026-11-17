import { useL10n } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import { version as pluginVersion } from "../../package.json";
import { createLogger } from "../utils/logger";
import styleEditorAssetFiles from "../utils/styleEditorAssetFiles.json";

const log = createLogger("style-editor");

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

const STYLE_EDITOR_ASSET_FILES = styleEditorAssetFiles satisfies Record<
  StyleEditorAssetKey,
  string
>;

const STYLE_EDITOR_RUNTIME_ASSETS: readonly RuntimeAssetDefinition[] = [
  {
    assetKey: "itemTypesDTS",
    sourceFile: STYLE_EDITOR_ASSET_FILES.itemTypesDTS,
    targetSegments: ["item.d.ts"],
    commentPrefix: "//",
  },
  {
    assetKey: "unitTypesDTS",
    sourceFile: STYLE_EDITOR_ASSET_FILES.unitTypesDTS,
    targetSegments: ["unit.d.ts"],
    commentPrefix: "//",
  },
  {
    assetKey: "styleTypesDTS",
    sourceFile: STYLE_EDITOR_ASSET_FILES.styleTypesDTS,
    targetSegments: ["style.d.ts"],
    commentPrefix: "//",
  },
  {
    assetKey: "styleUtilsDTS",
    sourceFile: STYLE_EDITOR_ASSET_FILES.styleUtilsDTS,
    targetSegments: ["styleUtils.d.ts"],
    commentPrefix: "//",
  },
  {
    assetKey: "jsConfigText",
    sourceFile: STYLE_EDITOR_ASSET_FILES.jsConfigText,
    targetSegments: ["jsconfig.json"],
    validate: hasRuntimeJSConfigContract,
  },
  {
    assetKey: "snippetsText",
    sourceFile: STYLE_EDITOR_ASSET_FILES.snippetsText,
    targetSegments: [".vscode", "banyan.code-snippets"],
    commentPrefix: "//",
  },
  {
    assetKey: "eslintConfigText",
    sourceFile: STYLE_EDITOR_ASSET_FILES.eslintConfigText,
    targetSegments: ["eslint.config.mjs"],
    commentPrefix: "//",
  },
  {
    assetKey: "eslintPluginText",
    sourceFile: STYLE_EDITOR_ASSET_FILES.eslintPluginText,
    targetSegments: ["eslint-plugin-banyan-style.mjs"],
    commentPrefix: "//",
  },
  // The style-utils globals used to be shipped as their own runtime asset.
  // `createBanyanStyleConfig()` now derives them from the typings files above,
  // so there is no separate file to copy (and reading one that no longer ships
  // aborted the whole startup).
  {
    assetKey: "packageJSONText",
    sourceFile: STYLE_EDITOR_ASSET_FILES.packageJSONText,
    targetSegments: ["package.json"],
    validate: hasRuntimePackageTypesEntry,
  },
] as const;

let cachedAssets: StyleEditorAssets | null = null;

function stripJSONCComments(source: string): string {
  let result = "";
  let inString = false;
  let stringQuote = "";
  let escaping = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (inString) {
      result += char;
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === "\\") {
        escaping = true;
        continue;
      }
      if (char === stringQuote) {
        inString = false;
        stringQuote = "";
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      stringQuote = char;
      result += char;
      continue;
    }

    if (char === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") {
        index += 1;
      }
      if (index < source.length) {
        result += source[index];
      }
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (
        index < source.length - 1 &&
        !(source[index] === "*" && source[index + 1] === "/")
      ) {
        index += 1;
      }
      index += 1;
      continue;
    }

    result += char;
  }

  return result;
}

export function parseStyleEditorJSCompilerOptions(
  jsConfigText: string,
): Record<string, unknown> {
  try {
    const parsed = JSON.parse(stripJSONCComments(jsConfigText)) as {
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
  const contents = await Zotero.File.getContentsFromURLAsync(
    getStyleEditorAssetURL(fileName),
  );
  if (!contents.trim()) {
    throw new Error(`Required style editor asset is empty: ${fileName}`);
  }
  return contents;
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
    log.error("activating the style editor window failed", e);
    ztoolkit.getGlobal("alert")(
      `${t("style-editor-error-prefix")}: ${String(e)}`,
    );
  }
}
