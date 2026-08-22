// Note: Validation here is static and heuristic; execution happens in sandbox.ts
import { StyleIdentifier } from "../../typings/server";
import type { Style, StyleUI } from "../../typings/style";
import { useL10n } from "../utils/locale";
import { createStyle } from "./sandbox";
import presetsManifest from "../../addon/content/styleEditor/presets/presets-manifest.json";

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
    ztoolkit.logError(e);
    throw e;
  }
  return dirPath;
}

export async function getStyleUI(style: StyleIdentifier): Promise<StyleUI> {
  const instant = await getStyle(style);
  return instant.UI ?? { cite: [], citation: [] };
}

/**
 * Get style from plugin styles index by id
 * @throws Error if:
 *  - Data directory cannot be ensured
 *  - Style with given id not found
 *  - Style file cannot be read
 */
export async function getStyle(style: StyleIdentifier): Promise<Style> {
  const exist = addon.data.styles.cache.get(style.id);
  if (exist) {
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
    ztoolkit.logError(e);
    throw e;
  }

  const instant = await createStyle(code);
  addon.data.styles.cache.set(style.id, instant);

  return instant;
}

export function invalidateStyleCache(styleID: string): void {
  addon.data.styles.cache.delete(styleID);
}

export async function readStyleFile(path: string): Promise<string> {
  try {
    return await IOUtils.readUTF8(path);
  } catch (e) {
    ztoolkit.logError(e);
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

function indexLoadedStyle(style: Style, filename: string): void {
  addon.data.styles.cache.delete(style.INFO.id);
  addon.data.styles.files.set(style.INFO.id, {
    id: style.INFO.id,
    title: style.INFO.title,
    citationType: style.INFO.citationType ?? "intext-citation",
    description: style.INFO.description,
    updated: style.INFO.updated,
    filename,
  });
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
    // For calling only, INFO is unessisery, but for style created from file in data directory, we need it to make indexing
    throw new Error(`Style file ${path} missing INFO.id`);
  }
  if (addon.data.styles.files.has(id)) {
    const existing = addon.data.styles.files.get(id);
    ztoolkit.logError(
      new Error(
        `Ignoring '${path}': style ID '${id}' is already used by '${existing!.filename}'`,
      ),
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
  }
  const paths = await IOUtils.getChildren(dirPath);
  for (const path of paths.toSorted()) {
    if (!path.endsWith(".js")) continue;
    try {
      await loadStyle(path);
    } catch (e) {
      ztoolkit.logError(e);
      continue;
    }
  }
}

export async function installPresetStyles(): Promise<void> {
  const dirPath = await ensureDataDir();

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
      ztoolkit.logError(e);
    }
  }
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
    ztoolkit.logError(e);
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
    // We have already filtered out missing entries
    const filename = entry!.filename;
    const fullPath = PathUtils.join(dirPath, filename);
    try {
      await IOUtils.remove(fullPath);
    } catch (e) {
      ztoolkit.logError(e);
    }
    addon.data.styles.files.delete(id);
    addon.data.styles.cache.delete(id);
    removed = true;
  }
  return removed;
}
