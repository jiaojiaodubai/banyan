import { StyleIdentifier } from "../../typings/server";
import type { CitationContext, Style, StyleUI } from "../../typings/style";
import { useL10n } from "../utils/locale";
import { createStyle } from "./sandbox";
import presetsManifest from "../../addon/content/styleEditor/presets/presets-manifest.json";
import { createLogger } from "../utils/logger";
import { StyleInstanceCache } from "../utils/styleInstanceCache";
import {
  parseStyleUpdatedTime,
  pickStyleDuplicateKeeper,
  resolveStyleWriteTarget,
  STYLE_FILE_EXTENSION,
  type StyleFileRecord,
  type StyleWriteTarget,
  type StyleWriteTargetIO,
} from "../utils/styleFiles";

/** A style file while the directory is being loaded, before it is indexed. */
type LoadedStyleFile = StyleFileRecord & { style: Style };

const log = createLogger("styles");

const t = useL10n();

/**
 * Executable style instances owned by this bundle (one per window). The shared
 * style index below holds metadata only; see `StyleInstanceCache` for why
 * instances must not be shared between windows.
 */
const styleInstances = new StyleInstanceCache<Style>();

/**
 * Item-menu declarations are executable (`visible`, `check`). They belong to
 * the main-window bundle, which installs these hooks from `styleIndex.ts`;
 * dialogs only ever produce the serializable summary below.
 */
export type StyleDeclarationSummary = {
  hasFieldPresets: boolean;
  itemFieldValidatorTypes: string[];
};

export type StyleIndexHooks = {
  load(style: Style): StyleDeclarationSummary;
  remove(styleId: string): void;
  clear(): void;
};

let styleIndexHooks: StyleIndexHooks | null = null;

/** Install the main-window executable index (see `src/modules/styleIndex.ts`). */
export function registerStyleIndexHooks(hooks: StyleIndexHooks): void {
  styleIndexHooks = hooks;
}

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
 * Render citation contexts with a style in the calling bundle. External
 * automation (the production smoke observer) calls this instead of reaching
 * into the plugin's private style cache.
 */
export async function generateStyle(
  style: StyleIdentifier,
  contexts: CitationContext[],
) {
  const instant = await getStyle(style);
  return instant.generate(contexts);
}

/**
 * Get style from plugin styles index by id
 * @throws Error if:
 *  - Data directory cannot be ensured
 *  - Style with given id not found
 *  - Style file cannot be read
 */
export async function getStyle(style: StyleIdentifier): Promise<Style> {
  const epoch = addon.data.styles.epoch;
  const cached = styleInstances.get(style.id, epoch);
  if (cached) {
    return cached;
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
  // The index may have changed while the file was being parsed. Only cache the
  // instance when the epoch it was read under is still current; otherwise the
  // next read has to rebuild it anyway.
  if (addon.data.styles.epoch === epoch) {
    styleInstances.set(style.id, instant, epoch);
  }

  return instant;
}

export async function readStyleFile(path: string): Promise<string> {
  try {
    return await IOUtils.readUTF8(path);
  } catch (e) {
    ztoolkit.logError(e);
    throw e;
  }
}

/** Write style code to a data-directory path the caller has already resolved. */
export async function writeStyleFile(
  fullPath: string,
  code: string,
): Promise<void> {
  await IOUtils.writeUTF8(fullPath, code);
}

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
 * Index one style. Bumping the shared epoch is what invalidates the executable
 * instances cached by every window, so a rewritten style is never served from
 * an older copy.
 */
function indexLoadedStyle(style: Style, filename: string): void {
  addon.data.styles.epoch += 1;
  const declarations = styleIndexHooks?.load(style) ?? {
    hasFieldPresets: false,
    itemFieldValidatorTypes: [],
  };
  addon.data.styles.files.set(style.INFO.id, {
    id: style.INFO.id,
    title: style.INFO.title,
    citationType: style.INFO.citationType ?? "intext-citation",
    description: style.INFO.description,
    updated: style.INFO.updated,
    filename,
    hasFieldPresets: declarations.hasFieldPresets,
    itemFieldValidatorTypes: declarations.itemFieldValidatorTypes,
  });
}

/** Directory operations the write-target resolver needs in the data dir. */
function createStyleWriteTargetIO(): StyleWriteTargetIO {
  return {
    dir: ensureDataDir,
    join: (dir, filename) => PathUtils.join(dir, filename),
    basename: (path) => PathUtils.filename(path),
    children: (dir) => IOUtils.getChildren(dir),
    exists: (path) => IOUtils.exists(path),
    readStyleId: async (path) => {
      try {
        const style = await createStyle(await readStyleFile(path));
        return style.INFO?.id || null;
      } catch {
        // A file that does not parse cannot claim the id.
        return null;
      }
    },
  };
}

/**
 * Where an import or an editor save should write a style with `styleID`.
 *
 * `indexed` / `file` both mean "a file already declares this id", so the
 * caller must confirm before overwriting; a new alias name is only chosen when
 * nothing claims the id (see `resolveStyleWriteTarget`).
 */
export function resolveStyleWriteTargetForId(
  styleID: string,
): Promise<StyleWriteTarget> {
  const indexed = addon.data.styles.files.get(styleID);
  return resolveStyleWriteTarget(
    styleID,
    indexed ? { filename: indexed.filename, title: indexed.title } : undefined,
    createStyleWriteTargetIO(),
  );
}

/** Every readable style file in the data dir that declares `styleID`. */
async function findStyleFilePathsById(styleID: string): Promise<string[]> {
  const io = createStyleWriteTargetIO();
  const dirPath = await io.dir();
  const paths = (await io.children(dirPath))
    .filter((path) => path.endsWith(STYLE_FILE_EXTENSION))
    .toSorted();
  const matches: string[] = [];
  for (const path of paths) {
    if ((await io.readStyleId(path)) === styleID) {
      matches.push(path);
    }
  }
  return matches;
}

/**
 * (Re)build the style index from the data directory.
 *
 * Two files may declare the same `INFO.id` - an import that ran while the index
 * was empty, a copy made outside Banyan, a leftover alias from an older build.
 * Only one can be indexed, and leaving the other on disk means it shadows or
 * resurrects on the next load, so the duplicate is resolved the way Zotero
 * resolves duplicate translator files: keep the newer `INFO.updated`, delete the
 * loser, and log the decision instead of prompting.
 */
export async function loadStyles(reset?: boolean): Promise<void> {
  const dirPath = await ensureDataDir();
  if (reset) {
    addon.data.styles.files.clear();
    addon.data.styles.epoch += 1;
  }
  const paths = (await IOUtils.getChildren(dirPath))
    .filter((path) => path.endsWith(STYLE_FILE_EXTENSION))
    .toSorted();
  const loaded = new Map<string, LoadedStyleFile>();
  const duplicates: Array<{
    keeper: LoadedStyleFile;
    discarded: LoadedStyleFile;
  }> = [];

  for (const path of paths) {
    try {
      const style = await createStyle(await readStyleFile(path));
      const id = style.INFO?.id;
      if (!id) {
        // A one-off style may omit INFO.id, but a file in the data directory
        // needs one so it can be indexed.
        log.error(`Style file is missing INFO.id: ${path}`);
        continue;
      }

      const candidate: LoadedStyleFile = {
        id,
        filename: PathUtils.filename(path),
        path,
        updated: parseStyleUpdatedTime(style.INFO.updated),
        style,
      };
      const existing = loaded.get(id);
      if (!existing) {
        loaded.set(id, candidate);
        continue;
      }

      const keeper = pickStyleDuplicateKeeper(existing, candidate);
      const discarded = keeper === existing ? candidate : existing;
      loaded.set(id, keeper);
      duplicates.push({ keeper, discarded });
      log.warn(
        `样式 ID“${id}”重复：保留“${keeper.filename}”（updated: ${keeper.updated}），删除“${discarded.filename}”（updated: ${discarded.updated}）`,
      );
    } catch (e) {
      log.error(`Failed to load style: ${path}`, e);
    }
  }

  for (const { discarded } of duplicates) {
    try {
      await IOUtils.remove(discarded.path);
    } catch (e) {
      log.error(`Failed to remove duplicate style file: ${discarded.path}`, e);
    }
  }

  for (const entry of loaded.values()) {
    // A non-reset reload (after an import) only has to pick up new or moved
    // files; re-indexing unchanged styles would evict their executable cache.
    const indexed = addon.data.styles.files.get(entry.id);
    if (!reset && indexed?.filename === entry.filename) {
      continue;
    }
    indexLoadedStyle(entry.style, entry.filename);
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

    // Overwrite by id. A file that already declares the id is overwritten after
    // a prompt even when it is not in the index; silently writing an alias next
    // to it is how one style ended up with two files.
    const target = await resolveStyleWriteTargetForId(styleId);
    if (target.kind === "indexed") {
      const overwrite = Services.prompt.confirm(
        // @ts-expect-error ignore
        null,
        t("styles-overwrite-title"),
        t("styles-id-overwrite-confirm", {
          args: { aTitle: style.INFO.title, bTitle: target.title ?? styleId },
        }),
      );
      if (!overwrite) {
        return false;
      }
    } else if (target.kind === "file") {
      const overwrite = Services.prompt.confirm(
        // @ts-expect-error ignore
        null,
        t("styles-overwrite-title"),
        t("styles-filename-overwrite-confirm", {
          args: { filename: PathUtils.filename(target.path) },
        }),
      );
      if (!overwrite) {
        return false;
      }
    }

    await writeStyleFile(target.path, code);
    indexLoadedStyle(style, PathUtils.filename(target.path));
    return true;
  } catch (e) {
    log.error("Failed to save style code", e);
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
    // Remove every file that declares the id, not only the indexed one: a
    // leftover duplicate would be indexed on the next load, so the deleted
    // style would come back after a restart.
    const paths = new Set(await findStyleFilePathsById(id));
    const indexedPath = PathUtils.join(dirPath, entry!.filename);
    if (!paths.has(indexedPath) && (await IOUtils.exists(indexedPath))) {
      paths.add(indexedPath);
    }
    for (const path of paths) {
      try {
        await IOUtils.remove(path);
      } catch (e) {
        log.error(`Failed to delete style file: ${path}`, e);
      }
    }
    addon.data.styles.files.delete(id);
    removed = true;
  }
  if (removed) {
    addon.data.styles.epoch += 1;
  }
  return removed;
}
