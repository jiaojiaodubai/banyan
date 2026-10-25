/**
 * Zotero implementations of the capabilities the core requires.
 *
 * Everything the core needs from Zotero lives here, so the core package stays
 * host-agnostic and the plugin only has to hand this object over.
 */
import type { ScriptItem } from "@banyan/core/types/style";
import type { ReadOptions } from "@banyan/core/types/styleUtils";
import type {
  HtmlRootLike,
  ResolvedStyleSource,
  StyleHostCapabilities,
} from "@banyan/core/host";
import { createBanyanRuntimeError } from "@banyan/core/sandbox/runtimeErrors";
import { isBanyanItem } from "@banyan/core/items/fields";
import { getMultilingualItems as getRelatedMultilingualItems } from "../relations";
import {
  getItemWithMergeFallback,
  getZoteroItemId,
  getZoteroItemUri,
  toBanyanItem,
} from "./items";

const HTML_ROOT_ID = "__banyan_html_root__";

/**
 * Parse an HTML fragment into a document subtree.
 *
 * Prefers the ambient global, which window contexts (the in-Zotero test page
 * and dialogs) expose directly, and falls back to the main window through
 * ztoolkit for the plugin's own sandbox scope.
 *
 * A missing DOM or a failed parse is reported instead of returning `null`: the
 * core only asks for a parser when the content carries markup, and leaving that
 * markup unparsed would render differently from a host that parses it.
 */
export function parseHtml(html: string): HtmlRootLike | null {
  const DOMParserCtor =
    (typeof DOMParser === "function" ? DOMParser : undefined) ||
    (ztoolkit.getGlobal("DOMParser") as (new () => DOMParser) | undefined);
  if (!DOMParserCtor) {
    throw createBanyanRuntimeError(
      "The Zotero host cannot parse HTML: DOMParser is unavailable in this scope.",
      { code: "host-capability" },
    );
  }

  const doc = new DOMParserCtor().parseFromString(
    `<div id="${HTML_ROOT_ID}">${html}</div>`,
    "text/html",
  );
  const root = doc.getElementById(HTML_ROOT_ID);
  if (!root) {
    throw createBanyanRuntimeError(
      "The Zotero host could not parse HTML markup: the parsed document has no fragment root.",
      { code: "host-capability" },
    );
  }
  return root as unknown as HtmlRootLike;
}

function normalizePathForContainment(path: string): string {
  const normalized = PathUtils.normalize(path).replace(/\\/g, "/");
  const trimmed = normalized.replace(/\/+$/g, "");
  return Zotero.isWin ? trimmed.toLowerCase() : trimmed;
}

function isPathInsideDirectory(candidate: string, directory: string): boolean {
  const normalizedCandidate = normalizePathForContainment(candidate);
  const normalizedDirectory = normalizePathForContainment(directory);
  return (
    normalizedCandidate === normalizedDirectory ||
    normalizedCandidate.startsWith(`${normalizedDirectory}/`)
  );
}

const OUTSIDE_DATA_DIR_MESSAGE =
  "Only files in banyan data directory are allowed";

/** Resolve a style-relative path inside the data directory's `banyan` folder. */
function resolvePath(path: string): string {
  const dataDir = Zotero.DataDirectory.dir;
  const banyanDir = PathUtils.normalize(PathUtils.join(dataDir, "banyan"));
  if (typeof path !== "string" || !path.trim()) {
    throw new Error("Invalid path to resolve");
  }
  const rawPath = path.trim();
  const isAbs =
    /^[a-zA-Z]:/.test(rawPath) ||
    rawPath.startsWith("/") ||
    rawPath.startsWith("\\");
  // `PathUtils.join` rejects `..` itself; check first so a traversal attempt
  // gets the host's boundary error instead of a platform-specific message.
  if (rawPath.split(/[\\/]+/).includes("..")) {
    throw new Error(OUTSIDE_DATA_DIR_MESSAGE);
  }
  let normalized: string;
  try {
    const candidate = isAbs ? rawPath : PathUtils.join(banyanDir, rawPath);
    normalized = PathUtils.normalize(candidate);
  } catch {
    throw new Error(OUTSIDE_DATA_DIR_MESSAGE);
  }
  if (!isPathInsideDirectory(normalized, banyanDir)) {
    throw new Error(OUTSIDE_DATA_DIR_MESSAGE);
  }
  return normalized;
}

async function readFile(
  relPath: string,
  options?: ReadOptions,
): Promise<Uint8Array> {
  return IOUtils.read(resolvePath(relPath), options);
}

/**
 * Resolve a style id for `callStyle()`, so one style can run another.
 *
 * Styles are flat files in the data directory: the index maps an `INFO.id` to
 * the file that carries it, and that file is the only thing a delegated style
 * is. Because the layout is flat, the called style's own directory *is* the
 * `banyan` directory, so the caller's `readFile` is handed back unchanged —
 * a delegated style reads the same assets the caller can read, and the
 * containment rules do not fork per style.
 *
 * An id that is not indexed resolves to `null`: the core reports
 * `delegation.unresolved` and the caller takes its fallback. A read failure
 * throws instead, so the core can say *why* the style could not be loaded.
 */
async function resolveStyle(id: string): Promise<ResolvedStyleSource | null> {
  const entry = addon.data.styles.files.get(id);
  if (!entry) {
    return null;
  }
  const dirPath = PathUtils.join(Zotero.DataDirectory.dir, "banyan");
  const code = await IOUtils.readUTF8(PathUtils.join(dirPath, entry.filename));
  return { code, readFile };
}

/**
 * Resolve the multilingual group of a style item, so the core never needs the
 * Zotero database itself. The item is re-read from the library first, which is
 * what makes a stale snapshot resolve to the surviving item.
 */
async function resolveMultilingualItems(
  item: ScriptItem,
): Promise<ScriptItem[]> {
  if (!isBanyanItem(item)) {
    throw new TypeError(
      "Multilingual utilities expect a Banyan item from citation contexts.",
    );
  }

  // The durable Zotero URI avoids resolving another device's cached local id
  // to an unrelated item; the local id is the fallback when it is absent.
  const itemUri = getZoteroItemUri(item);
  const zoteroItem = await getItemWithMergeFallback(
    getZoteroItemId(item),
    itemUri,
  );
  if (!zoteroItem) {
    return [];
  }
  const relatedItems = await getRelatedMultilingualItems(zoteroItem);
  return relatedItems
    .filter((relatedItem) => !relatedItem.deleted)
    .map((relatedItem) => toBanyanItem(relatedItem) as unknown as ScriptItem);
}

export const zoteroCapabilities: StyleHostCapabilities = {
  parseHtml,
  readFile,
  resolveMultilingualItems,
  // Optional: without it, `callStyle()` reports `unresolved` and styles that
  // declare dependencies still run through their own fallback.
  resolveStyle,
};
