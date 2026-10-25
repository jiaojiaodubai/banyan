import { StyleIdentifier } from "../../typings/server";
import type {
  ParamDeclarations,
  Style,
  StyleOptionParam,
  StyleOptionValues,
} from "@banyan/core/types/style";
import {
  resolveStyleOptionState,
  type StyleOptionState,
} from "@banyan/core/validation/paramValues";
import { useL10n } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import { createStyle } from "./sandbox";
import { toStyleOptionParamInfos } from "./styleList";
import presetsManifest from "../../addon/content/styleEditor/presets/presets-manifest.json";
import { createLogger } from "../utils/logger";
import type { IndexedItemFieldValidators } from "../../typings/styleIndex";

const log = createLogger("styles");

const t = useL10n();

export async function ensureDataDir(): Promise<string> {
  const dataDir = Zotero.DataDirectory.dir;
  const dirName = "banyan";
  const dirPath = PathUtils.join(dataDir, dirName);
  try {
    await IOUtils.makeDirectory(dirPath, {
      createAncestors: true,
      ignoreExisting: true,
    });
  } catch (e) {
    log.error("创建样式数据目录失败", e);
    throw e;
  }
  return dirPath;
}

export async function getParamDeclarations(
  style: StyleIdentifier,
): Promise<ParamDeclarations> {
  const instant = await getStyle(style, { recordLastUsed: false });
  return {
    style: instant.STYLE_OPTIONS ?? [],
    citation: instant.CITATION_PARAMS ?? [],
    cite: instant.CITE_PARAMS ?? [],
  };
}

/** Reading a style for display only must not change what the item menu uses. */
type ReadStyleOptions = { recordLastUsed?: boolean };

/**
 * Declarations plus stored/effective values for one style.
 *
 * The settings UI and the refresh path both go through the core resolver, so
 * what the dialog shows and what `generate()` reads cannot drift.
 *
 * This is a read: a chooser previewing rows must not rewrite `lastUsedStyleId`
 * (and re-index the item menu) merely because the user browsed a style.
 */
export async function getStyleOptionState(
  style: StyleIdentifier,
  values?: StyleOptionValues,
): Promise<{ params: StyleOptionParam[]; state: StyleOptionState }> {
  const instant = await getStyle(style, { recordLastUsed: false });
  const params = instant.STYLE_OPTIONS ?? [];
  return { params, state: resolveStyleOptionState(params, values) };
}

/**
 * Style id of the last style used to generate output (document refresh,
 * "Create Output"), not counting a read for display or an edit in the style
 * editor.
 */
export const LAST_USED_STYLE_PREF = "lastUsedStyleId" as const;

function recordLastUsedStyle(styleId: string): void {
  try {
    if (getPref(LAST_USED_STYLE_PREF) === styleId) {
      return;
    }
    setPref(LAST_USED_STYLE_PREF, styleId);
    notifyStyleIndexChanged();
  } catch (e) {
    log.error("记录最近使用的样式失败", e);
  }
}

/**
 * Get style from plugin styles index by id
 *
 * `recordLastUsed` is for the paths that are about to render with the style;
 * a chooser previewing rows must leave the preference alone.
 *
 * @throws Error if:
 *  - Data directory cannot be ensured
 *  - Style with given id not found
 *  - Style file cannot be read
 */
export async function getStyle(
  style: StyleIdentifier,
  { recordLastUsed = true }: ReadStyleOptions = {},
): Promise<Style> {
  const exist = addon.data.styles.cache.get(style.id);
  if (exist) {
    if (recordLastUsed) {
      recordLastUsedStyle(style.id);
    }
    return exist;
  }

  const styleEntry = addon.data.styles.files.get(style.id);
  if (!styleEntry) {
    Zotero.getMainWindow().alert(
      t("styles-notfound-alert", { args: { title: style.title } }),
    );
    throw new Error(`Style with id ${style.id} not found`);
  }

  let code;
  const dirPath = await ensureDataDir();
  const fullPath = PathUtils.join(dirPath, styleEntry.filename);
  try {
    code = await IOUtils.readUTF8(fullPath);
  } catch (e) {
    log.error(`读取样式文件失败：${fullPath}`, e);
    throw e;
  }

  const instant = await createStyle(code);
  addon.data.styles.cache.set(style.id, instant);
  if (recordLastUsed) {
    recordLastUsedStyle(style.id);
  }

  return instant;
}

export function invalidateStyleCache(styleID: string): void {
  addon.data.styles.cache.delete(styleID);
}

export async function readStyleFile(path: string): Promise<string> {
  try {
    return await IOUtils.readUTF8(path);
  } catch (e) {
    log.error(`读取样式文件失败：${path}`, e);
    throw e;
  }
}

export async function saveStyleCodeById(
  styleID: string,
  code: string,
): Promise<string> {
  const fullPath = await getStyleFilePathById(styleID);
  await IOUtils.writeUTF8(fullPath, code);
  return fullPath;
}

const STYLE_FILE_EXTENSION = ".js";
const STYLE_PRESETS_DIR = "presets";
const STYLE_PRESET_FILES: readonly string[] = presetsManifest;

function getStyleEditorAssetURL(...segments: string[]): string {
  return `chrome://${addon.data.config.addonRef}/content/styleEditor/${segments.join("/")}`;
}

async function readStylePresetFile(fileName: string): Promise<string> {
  return Zotero.File.getContentsFromURLAsync(
    getStyleEditorAssetURL(STYLE_PRESETS_DIR, fileName),
  );
}

/**
 * Index one style. Announcing the change here keeps every path (startup, import,
 * overwrite, preset install, style-editor save) in sync with the item menu and
 * the preference list.
 */
function indexLoadedStyle(style: Style, filename: string): void {
  addon.data.styles.cache.delete(style.INFO.id);
  addon.data.styles.files.set(style.INFO.id, {
    id: style.INFO.id,
    title: style.INFO.title,
    citationType: style.INFO.citationType ?? "intext-citation",
    description: style.INFO.description,
    updated: style.INFO.updated,
    filename,
    optionParams: toStyleOptionParamInfos(style.STYLE_OPTIONS),
  });
  indexStyleFieldPresets(style);
  indexStyleItemFieldValidators(style);
  notifyStyleIndexChanged();
}

/**
 * Index the presets of a style that declares them. Their `visible` closures hold
 * the style's sandbox alive, so only styles using the feature pay for it.
 */
function indexStyleFieldPresets(style: Style): void {
  const styleId = style.INFO.id;
  const presets = style.ITEM_FIELD_PRESETS;
  if (!presets?.length) {
    addon.data.styles.fieldPresets.delete(styleId);
    return;
  }
  const styleTitle = style.INFO.title || styleId;
  addon.data.styles.fieldPresets.set(
    styleId,
    presets.map((preset) => ({
      ...preset,
      key: `${styleId}:${preset.id}`,
      styleId,
      styleTitle,
    })),
  );
}

/**
 * Index the item-type keyed field checks of a style that declares them. The
 * checker closures hold the style's sandbox alive, so only styles using the
 * feature pay for it.
 */
function indexStyleItemFieldValidators(style: Style): void {
  const styleId = style.INFO.id;
  const byType = style.ITEM_FIELD_VALIDATORS;
  if (!byType || !Object.keys(byType).length) {
    addon.data.styles.itemFieldValidators.delete(styleId);
    return;
  }
  addon.data.styles.itemFieldValidators.set(styleId, {
    styleId,
    styleTitle: style.INFO.title || styleId,
    byType,
  });
}

type StyleIndexListener = () => void;

const styleIndexListeners = new Set<StyleIndexListener>();

/** Depth of the index updates running; a batch notifies once when it ends. */
let styleIndexBatchDepth = 0;
let styleIndexNotifyPending = false;

/**
 * Register a callback invoked after the style index changes (load/import/
 * install/delete). The item menu rebuilds itself from it.
 */
export function onStyleIndexChanged(listener: StyleIndexListener): void {
  styleIndexListeners.add(listener);
}

/** Run several index updates as one notification (see `styleIndexBatchDepth`). */
export async function withStyleIndexBatch<T>(
  run: () => Promise<T>,
): Promise<T> {
  styleIndexBatchDepth++;
  try {
    return await run();
  } finally {
    styleIndexBatchDepth--;
    if (!styleIndexBatchDepth && styleIndexNotifyPending) {
      styleIndexNotifyPending = false;
      notifyStyleIndexChanged();
    }
  }
}

/** Styles that declare quick marks or field checks, sorted by title. */
export function getItemMenuStyles(): { id: string; title: string }[] {
  return Array.from(addon.data.styles.files.values())
    .filter(
      (style) => hasFieldPresets(style.id) || hasItemFieldValidators(style.id),
    )
    .map(({ id, title }) => ({ id, title }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** Whether a style currently contributes quick marks. */
export function hasFieldPresets(styleId: string): boolean {
  return addon.data.styles.fieldPresets.has(styleId);
}

/** Whether a style currently contributes field checks. */
export function hasItemFieldValidators(styleId: string): boolean {
  return addon.data.styles.itemFieldValidators.has(styleId);
}

/** Whether a style contributes anything to the item menu. */
export function hasItemMenuDeclarations(styleId: string): boolean {
  return hasFieldPresets(styleId) || hasItemFieldValidators(styleId);
}

/** Field-check declarations of one indexed style, if any. */
export function getStyleItemFieldValidators(
  styleId: string,
): IndexedItemFieldValidators | undefined {
  return addon.data.styles.itemFieldValidators.get(styleId);
}

function notifyStyleIndexChanged(): void {
  if (styleIndexBatchDepth) {
    styleIndexNotifyPending = true;
    return;
  }
  for (const listener of styleIndexListeners) {
    try {
      listener();
    } catch (e) {
      log.error("样式索引监听器执行失败", e);
    }
  }
}

function toSafeStyleFilenameFragment(value: string): string {
  const normalized = String(value || "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "style";
}

function getStyleFilenameBase(styleID: string): string {
  return toSafeStyleFilenameFragment(styleID);
}

function getStyleFilenameSuffix(styleID: string): string {
  const rawSegments = styleID
    .split(/[\\/:@#?.]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const lastSegment = rawSegments[rawSegments.length - 1] || styleID;
  return toSafeStyleFilenameFragment(lastSegment).slice(0, 24) || "id";
}

async function resolveUniqueStyleFilename(
  styleID: string,
  dirPath: string,
): Promise<string> {
  const indexed = addon.data.styles.files.get(styleID);
  if (indexed?.filename) {
    return indexed.filename;
  }

  const usedFilenames = new Set(
    Array.from(addon.data.styles.files.values())
      .filter((entry) => entry.id !== styleID)
      .map((entry) => entry.filename),
  );

  const base = getStyleFilenameBase(styleID);
  const suffix = getStyleFilenameSuffix(styleID);

  let attempt = 0;
  while (attempt < 200) {
    const middle =
      attempt === 0
        ? ""
        : attempt === 1
          ? `--${suffix}`
          : `--${suffix}-${attempt}`;
    const filename = `${base}${middle}${STYLE_FILE_EXTENSION}`;
    const fullPath = PathUtils.join(dirPath, filename);
    if (!usedFilenames.has(filename) && !(await IOUtils.exists(fullPath))) {
      return filename;
    }
    attempt += 1;
  }

  throw new Error(`Cannot resolve unique style filename for id '${styleID}'`);
}

export async function getStyleFilePathById(styleID: string): Promise<string> {
  const dirPath = await ensureDataDir();
  const filename = await resolveUniqueStyleFilename(styleID, dirPath);
  return PathUtils.join(dirPath, filename);
}

/**
 * Load a style file from given path and add to plugin styles index
 */
export async function loadStyle(path: string): Promise<void> {
  const code = await readStyleFile(path);
  const style = await createStyle(code);
  const id = style.INFO?.id;
  if (!id) {
    // A one-off style may omit INFO.id, but a file in the data directory needs
    // one so it can be indexed.
    throw new Error(`Style file ${path} missing INFO.id`);
  }
  if (addon.data.styles.files.has(id)) {
    const existing = addon.data.styles.files.get(id);
    log.warn(
      `Ignoring '${path}': style ID '${id}' is already used by '${existing!.filename}'`,
    );
    return;
  }
  indexLoadedStyle(style, PathUtils.filename(path));
}

/**
 * Reset and load all styles from data directory into plugin styles index
 */
export async function loadStyles(reset?: boolean): Promise<void> {
  const dirPath = await ensureDataDir();
  if (reset) {
    addon.data.styles.files.clear();
    addon.data.styles.cache.clear();
    addon.data.styles.fieldPresets.clear();
    addon.data.styles.itemFieldValidators.clear();
    // The index stays empty when the directory has no readable style left, so
    // the menu has to hear about the cleared index before the files are read.
    notifyStyleIndexChanged();
  }
  const paths = await IOUtils.getChildren(dirPath);
  await withStyleIndexBatch(async () => {
    for (const path of paths.toSorted()) {
      if (!path.endsWith(".js")) continue;
      try {
        await loadStyle(path);
      } catch (e) {
        log.error(`加载样式失败：${path}`, e);
        continue;
      }
    }
  });
}

export async function installPresetStyles(): Promise<void> {
  const dirPath = await ensureDataDir();

  await withStyleIndexBatch(async () => {
    for (const fileName of STYLE_PRESET_FILES) {
      try {
        const code = await readStylePresetFile(fileName);
        const style = await createStyle(code);
        const styleId = style.INFO?.id;
        if (!styleId) {
          throw new Error(`Preset style ${fileName} missing INFO.id`);
        }

        if (addon.data.styles.files.has(styleId)) {
          continue;
        }

        const destPath = PathUtils.join(dirPath, fileName);
        if (await IOUtils.exists(destPath)) {
          continue;
        }

        await IOUtils.writeUTF8(destPath, code);
        indexLoadedStyle(style, fileName);
      } catch (e) {
        log.error(`安装预设样式失败：${fileName}`, e);
      }
    }
  });
}

/**
 * Import (load) a style file selected by user
 */
export async function promptImportStyle(): Promise<boolean> {
  try {
    const picker = new ztoolkit.FilePicker(
      t("styles-import-picker-title"),
      "open",
      [[t("styles-import-picker-filter-style"), "*.js"]],
    );
    const picked = await picker.open();
    if (!picked) {
      return false;
    }
    const srcPath = String(picked);
    const code = await readStyleFile(srcPath);
    const style = await createStyle(code);
    const styleId = style.INFO?.id;
    if (!styleId) {
      throw new Error(`Style file ${srcPath} missing INFO.id`);
    }

    if (addon.data.styles.files.has(styleId)) {
      const existing = addon.data.styles.files.get(styleId);
      const overwrite = Services.prompt.confirm(
        // @ts-expect-error ignore
        null,
        t("styles-overwrite-title"),
        t("styles-id-overwrite-confirm", {
          args: { aTitle: style.INFO.title, bTitle: existing!.title },
        }),
      );
      if (!overwrite) {
        return false;
      }
    }

    const destPath = await getStyleFilePathById(style.INFO.id);
    await IOUtils.writeUTF8(destPath, code);

    indexLoadedStyle(style, PathUtils.filename(destPath));
    return true;
  } catch (e) {
    log.error("保存样式代码失败", e);
    return false;
  }
}

/**
 * Delete styles by ids, remove from plugin styles index, remove from cache and delete files
 */
export async function deleteStylesById(ids: string[]): Promise<boolean> {
  if (!ids.length) {
    return false;
  }
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const targets = uniqueIds
    .map((id) => ({ id, entry: addon.data.styles.files.get(id) }))
    .filter((target) => target.entry);
  if (!targets.length) {
    return false;
  }
  const firstTitle = targets[0].entry!.title || targets[0].id;
  const ok = Services.prompt.confirm(
    // @ts-expect-error ignore
    null,
    t("styles-delete-title"),
    t("styles-delete-confirm", {
      args: { title: firstTitle, count: targets.length },
    }),
  );
  if (!ok) {
    return false;
  }
  const dirPath = await ensureDataDir();
  let removed = false;
  for (const { id, entry } of targets) {
    const filename = entry!.filename;
    const fullPath = PathUtils.join(dirPath, filename);
    try {
      await IOUtils.remove(fullPath);
    } catch (e) {
      log.error(`删除样式文件失败：${fullPath}`, e);
    }
    addon.data.styles.files.delete(id);
    addon.data.styles.cache.delete(id);
    addon.data.styles.fieldPresets.delete(id);
    addon.data.styles.itemFieldValidators.delete(id);
    removed = true;
  }
  if (removed) {
    notifyStyleIndexChanged();
  }
  return removed;
}
