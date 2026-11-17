/**
 * File-level rules for the styles kept in the data directory: canonical and
 * alias file names, where an import or a save should write, and which of two
 * files declaring the same `INFO.id` to keep.
 *
 * The module deliberately stays free of Zotero globals: `resolveStyleWriteTarget()`
 * takes the directory operations it needs, so every rule here can be exercised
 * in `tests-node` without a Zotero runtime.
 */

export const STYLE_FILE_EXTENSION = ".js";

/** Upper bound of alias names before the caller has to give up. */
const MAX_STYLE_FILENAME_ATTEMPTS = 200;

/** Length of the id tail appended to an alias file name. */
const STYLE_FILENAME_SUFFIX_LENGTH = 24;

function toSafeStyleFilenameFragment(value: string): string {
  const normalized = String(value || "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "style";
}

export function getStyleFilenameBase(styleID: string): string {
  return toSafeStyleFilenameFragment(styleID);
}

export function getStyleFilenameSuffix(styleID: string): string {
  const rawSegments = styleID
    .split(/[\\/:@#?.]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const lastSegment = rawSegments[rawSegments.length - 1] || styleID;
  return (
    toSafeStyleFilenameFragment(lastSegment).slice(
      0,
      STYLE_FILENAME_SUFFIX_LENGTH,
    ) || "id"
  );
}

/** Whether `filename` is the name the importer picks for a brand-new style. */
export function isCanonicalStyleFilename(
  styleID: string,
  filename: string,
): boolean {
  return filename === `${getStyleFilenameBase(styleID)}${STYLE_FILE_EXTENSION}`;
}

/**
 * Pick the file name for a style that has no file in the data directory yet.
 *
 * `--<id tail>` keeps two styles whose ids sanitize to the same name apart.
 * This is only for *new* files: overwriting a file that already declares the
 * id has to go through `resolveStyleWriteTarget()`, otherwise one style ends up
 * with two files and the older copy can shadow the newer one on the next load.
 */
export function pickStyleFilename(
  styleID: string,
  takenFilenames: Iterable<string>,
): string {
  const taken = new Set(takenFilenames);
  const base = getStyleFilenameBase(styleID);
  const suffix = getStyleFilenameSuffix(styleID);

  for (let attempt = 0; attempt < MAX_STYLE_FILENAME_ATTEMPTS; attempt++) {
    const middle =
      attempt === 0
        ? ""
        : attempt === 1
          ? `--${suffix}`
          : `--${suffix}-${attempt}`;
    const filename = `${base}${middle}${STYLE_FILE_EXTENSION}`;
    if (!taken.has(filename)) {
      return filename;
    }
  }

  throw new Error(`Cannot resolve unique style filename for id '${styleID}'`);
}

/** Where an import or an editor save should write the style. */
export type StyleWriteTarget =
  /** The id is in the current index; the style is already listed. */
  | { kind: "indexed"; path: string; title?: string }
  /** A data-directory file declares the id but did not make it into the index. */
  | { kind: "file"; path: string }
  /** Nothing claims the id; `path` carries a non-conflicting file name. */
  | { kind: "new"; path: string };

/** Directory operations `resolveStyleWriteTarget()` needs from its host. */
export type StyleWriteTargetIO = {
  /** The styles directory, created on demand by the caller. */
  dir: () => Promise<string>;
  join: (dir: string, filename: string) => string;
  basename: (path: string) => string;
  /** Every file in the directory, as full paths. */
  children: (dir: string) => Promise<string[]>;
  exists: (path: string) => Promise<boolean>;
  /** `INFO.id` of the style stored in `path`, or null when it cannot be read. */
  readStyleId: (path: string) => Promise<string | null>;
};

/**
 * Resolve where to write a style with `styleID` and classify the conflict.
 *
 * The index is the fast path, but it only knows the files that loaded in this
 * session. A file that failed to load, was copied in while the plugin was not
 * watching, or was left behind by an older build still declares the id, and
 * silently writing a new `--<id>` file next to it is what produced duplicate
 * styles before. Both callers prompt before overwriting, so overwriting is the
 * correct answer here.
 */
export async function resolveStyleWriteTarget(
  styleID: string,
  indexed: { filename: string; title?: string } | undefined,
  io: StyleWriteTargetIO,
): Promise<StyleWriteTarget> {
  const dir = await io.dir();

  if (indexed?.filename) {
    return {
      kind: "indexed",
      path: io.join(dir, indexed.filename),
      title: indexed.title,
    };
  }

  const stylePaths = (await io.children(dir))
    .filter((path) => path.endsWith(STYLE_FILE_EXTENSION))
    .toSorted();
  const canonicalPath = io.join(
    dir,
    `${getStyleFilenameBase(styleID)}${STYLE_FILE_EXTENSION}`,
  );

  // Check the importer's own name first: it is the common case and saves a
  // parse of every other style in the directory.
  const candidates = [
    canonicalPath,
    ...stylePaths.filter((path) => path !== canonicalPath),
  ];
  for (const path of candidates) {
    if (!(await io.exists(path))) {
      continue;
    }
    if ((await io.readStyleId(path)) === styleID) {
      return { kind: "file", path };
    }
  }

  const taken = new Set(stylePaths.map((path) => io.basename(path)));
  return {
    kind: "new",
    path: io.join(dir, pickStyleFilename(styleID, taken)),
  };
}

/** One style file as seen while loading the directory. */
export type StyleFileRecord = {
  id: string;
  filename: string;
  path: string;
  /** `INFO.updated` in milliseconds; 0 when the style has no usable date. */
  updated: number;
};

/** `INFO.updated` as epoch milliseconds; missing or invalid dates sort oldest. */
export function parseStyleUpdatedTime(updated: unknown): number {
  if (typeof updated !== "string" || !updated.trim()) {
    return 0;
  }
  const parsed = Date.parse(updated);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Which of two files declaring the same style id to keep.
 *
 * Mirrors Zotero's duplicate-translator handling: the newer `INFO.updated`
 * wins; on a tie, the importer's canonical file name wins over an alias; and
 * otherwise the file scanned first is kept, so the outcome is deterministic.
 * The caller deletes the other file and logs the decision — there is no
 * prompt, exactly like Zotero.
 */
export function pickStyleDuplicateKeeper<T extends StyleFileRecord>(
  existing: T,
  candidate: T,
): T {
  if (existing.updated !== candidate.updated) {
    return existing.updated > candidate.updated ? existing : candidate;
  }

  const existingIsCanonical = isCanonicalStyleFilename(
    existing.id,
    existing.filename,
  );
  const candidateIsCanonical = isCanonicalStyleFilename(
    candidate.id,
    candidate.filename,
  );
  if (existingIsCanonical !== candidateIsCanonical) {
    return existingIsCanonical ? existing : candidate;
  }

  return existing;
}
