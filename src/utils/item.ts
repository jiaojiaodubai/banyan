import type { ExtraMap, Item } from "../../typings/item";
import type { Cite, CitationContext, ScriptItem } from "../../typings/style";
import { getReplacingItemForURI } from "./uri";
type ItemFieldsBaseMapper = Pick<
  _ZoteroTypes.ItemFields,
  "getID" | "getBaseIDFromTypeAndField" | "getName"
>;

export type ParsedExtraLine = {
  raw: string;
  normalizedKey: string | null;
  value: string;
};

/**
 * Variable-line syntax of the `extra` field, mirroring Zotero's own readers
 * (`extractExtraFields` / `combineExtraFields`): a key that starts with a letter
 * and continues with letters, digits, spaces, hyphens or underscores, followed
 * by a non-empty value. Anything else is prose.
 */
const EXTRA_PAIR_PATTERN = /^([\p{L}][\p{L}\p{N} _-]*?)[ \t]*:[ \t]*(\S.*)$/u;

/** Legacy citeproc.js cheater syntax `{:author: Smith}`, still read by Zotero. */
const EXTRA_CHEATER_PAIR_PATTERN =
  /^[ \t]*\{:[ \t]*([\p{L}][\p{L}\p{N} _-]*?)[ \t]*:[ \t]*(\S.*?)[ \t]*\}[ \t]*$/u;

/** Key charset of a variable line, without the `: value` part. */
const EXTRA_KEY_PATTERN = /^[\p{L}][\p{L}\p{N} _-]*$/u;

/** Split one `extra` line into its normalized key and value, or prose. */
export function parseExtraLine(raw: string): ParsedExtraLine {
  const match =
    raw.match(EXTRA_PAIR_PATTERN) ?? raw.match(EXTRA_CHEATER_PAIR_PATTERN);
  if (!match) {
    return { raw, normalizedKey: null, value: "" };
  }
  return {
    raw,
    normalizedKey: normalizeExtraKey(match[1]),
    value: match[2].trim(),
  };
}

/**
 * Whether a key can be written as, and read back from, a variable line. A key
 * refused here is one a write could never match again.
 */
export function isValidExtraKey(value: unknown): boolean {
  const key = typeof value === "string" ? value.trim() : "";
  return EXTRA_KEY_PATTERN.test(key);
}

/**
 * Normalize an extra-field key to canonical kebab-case.
 *
 * Digits are intentionally kept attached to letters (e.g. "date2" stays
 * "date2") so numeric-suffixed keys like `date2` / `issue2` remain stable.
 */
export function normalizeExtraKey(value: unknown): string {
  let text: string;
  switch (typeof value) {
    case "string":
      text = value;
      break;
    case "number":
    case "boolean":
      text = String(value);
      break;
    default:
      text = "";
  }
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)(?=[A-Z][a-z])/g, "$1 ")
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Convert an extra-field key to Zotero's preferred title-case form for
 * writing into the `extra` field (e.g. `Type`, `Genre`, `Status`,
 * `Citation Key`). Matching/comparison should still go through
 * `normalizeExtraKey()` (lowercase kebab-case).
 *
 * Existing capitals (e.g. acronyms like `DOI`, `arXiv`) are preserved.
 */
export function toTitleCaseExtraKey(value: unknown): string {
  let text: string;
  switch (typeof value) {
    case "string":
      text = value;
      break;
    case "number":
    case "boolean":
      text = String(value);
      break;
    default:
      text = "";
  }
  return (
    text
      // Split camelCase / PascalCase boundaries: "authorID" -> "author ID".
      // Only split when the uppercase letter starts an acronym (not followed
      // by lowercase), so words like "arXiv" are left intact.
      .replace(/([a-z0-9])([A-Z])(?=[^a-z]|$)/g, "$1 $2")
      .replace(/([A-Z]+)(?=[A-Z][a-z])/g, "$1 ")
      // Normalize separators (spaces, hyphens, underscores) to single spaces
      .replace(/[\s_-]+/g, " ")
      .trim()
      // Capitalize the first letter of each word, preserving the rest
      .replace(/\b[a-z]/g, (ch) => ch.toUpperCase())
  );
}

function parseExtra(extraText: string): ExtraMap {
  const out: ExtraMap = {};
  const text = typeof extraText === "string" ? extraText : "";
  for (const line of parseExtraLines(text)) {
    const key = line.normalizedKey;
    if (!key) continue;

    // Repeated keys become an array: a community convention Zotero itself never
    // writes, kept for compatibility.
    const value = line.value;
    const prev = out[key];
    if (prev === undefined) {
      out[key] = value;
    } else if (Array.isArray(prev)) {
      prev.push(value);
      out[key] = prev;
    } else {
      out[key] = [prev, value];
    }
  }
  return out;
}

export function parseExtraLines(extraText: string): ParsedExtraLine[] {
  return extraText.split(/\r?\n/).map(parseExtraLine);
}

export function replaceExtraFieldBlock(
  extraText: string,
  normalizedKey: string,
  values: readonly string[],
): string {
  const newline = extraText.includes("\r\n") ? "\r\n" : "\n";
  const remaining = parseExtraLines(extraText)
    .filter((line) => line.normalizedKey !== normalizedKey)
    .map((line) => line.raw);

  while (remaining.length && !remaining[remaining.length - 1].trim()) {
    remaining.pop();
  }

  return [...remaining, ...values].join(newline);
}

const EXCLUDED_FIELDS = new Set([
  "version",
  "abstractNote",
  "collections",
  "dateAdded",
  "dateModified",
  "notes",
]);

function stripExcludedFields(json: unknown): void {
  if (!json || typeof json !== "object") return;
  const record = json as Record<string, unknown>;
  for (const field of EXCLUDED_FIELDS) {
    if (field in record) {
      delete record[field];
    }
  }
}

export function assignBaseFieldAliases(
  itemType: string,
  record: Record<string, unknown>,
  itemFields: ItemFieldsBaseMapper = Zotero.ItemFields,
): void {
  for (const [field, value] of Object.entries(record)) {
    if (typeof value !== "string" || !value) continue;

    if (!itemFields.getID(field)) continue;

    let baseFieldID: number | string | false;
    try {
      baseFieldID = itemFields.getBaseIDFromTypeAndField(itemType, field);
    } catch (error) {
      if (
        error instanceof Error &&
        /^Invalid field '.+'$/.test(error.message)
      ) {
        continue;
      }
      throw error;
    }

    if (!baseFieldID) continue;

    const baseFieldName = itemFields.getName(baseFieldID);
    if (
      typeof baseFieldName !== "string" ||
      !baseFieldName ||
      baseFieldName === field
    ) {
      continue;
    }

    const existing = record[baseFieldName];
    if (typeof existing === "string" && existing) {
      continue;
    }

    record[baseFieldName] = value;
  }
}

export function toBanyanItem(zoteroItem: Zotero.Item): Item {
  const json = (zoteroItem.toJSON?.() ?? {}) as Record<string, unknown>;

  // Keep Banyan item payload minimal for citation generation.
  stripExcludedFields(json);
  assignBaseFieldAliases(String(json.itemType ?? ""), json);

  json.id = zoteroItem.id;
  json.uri = Zotero.URI.getItemURI(zoteroItem);
  json.year = zoteroItem.getField("year");
  json.firstCreator = zoteroItem.firstCreator;

  // Parse extra (string) into structured map
  const extraText = typeof json.extra === "string" ? json.extra : "";
  json.extra = parseExtra(extraText);

  // Simplify tags array
  const rawTags = Array.isArray(json.tags) ? json.tags : [];
  json.tags = rawTags
    .map((tag) => {
      if (!tag || typeof tag !== "object") {
        return "";
      }
      return String((tag as { tag?: unknown }).tag ?? "");
    })
    .filter(Boolean);

  // Simplify relations map
  const rawRelations = json.relations;
  json.relations =
    rawRelations && typeof rawRelations === "object"
      ? Object.fromEntries(
          Object.entries(rawRelations as Record<string, unknown>).map(
            ([k, v]) => [
              k,
              // Strip URI prefix (e.g., "http://zotero.org/users/USERID/items/")
              (Array.isArray(v) ? v : [])
                .map((uri) => String(uri ?? ""))
                .map((uri) => uri.split("/").pop()),
            ],
          ),
        )
      : {};

  return json as Item;
}

/**
 * Resolve a Zotero item from a citation identity with fallback for merged
 * items. Implements the same lookup order as
 * Zotero.Integration.URIMap.prototype.getZoteroItemForURIs so that
 * duplicate-item merges resolve to the surviving item.
 *
 * @param itemId - The item ID from citation (optional)
 * @param itemUri - The item URI from citation (optional)
 * @returns The Zotero item, or null if not found
 */
export async function getItemWithMergeFallback(
  itemId?: number,
  itemUri?: string,
): Promise<Zotero.Item | null> {
  if (itemUri) {
    try {
      const itemFromUri = await Zotero.URI.getURIItem(itemUri);
      if (itemFromUri && !itemFromUri.deleted) {
        return itemFromUri;
      }
    } catch {
      // URI resolution failed, continue to fallback checks.
    }

    const replacer = await getReplacingItemForURI(itemUri);
    if (replacer) {
      return replacer;
    }
  }

  if (itemId && Number.isFinite(itemId) && itemId > 0) {
    try {
      const item = await Zotero.Items.getAsync(itemId);
      if (item && !item.deleted) {
        return item;
      }
    } catch {
      // Item not found or error.
    }
  }

  return null;
}

/**
 * Re-resolve a single cite against the live library. The result carries the
 * surviving item's id and URI, which is what replaces the stale identity a
 * document still holds after duplicates were merged or items were imported.
 */
async function resolveCiteWithLiveItem(
  cite: Cite,
  importedItems?: Map<string, Zotero.Item>,
): Promise<Cite> {
  try {
    const imported = cite.item.uri
      ? importedItems?.get(cite.item.uri)
      : undefined;
    const item =
      imported ?? (await getItemWithMergeFallback(cite.item.id, cite.item.uri));
    if (!item) {
      return cite;
    }
    return { ...cite, item: toBanyanItem(item) };
  } catch (e) {
    ztoolkit.logError(e);
    return cite;
  }
}

/**
 * Re-fetch live item data for a flat list of cites. Each resolved cite gets a
 * fresh `item` snapshot from Zotero; cites that cannot be resolved keep their
 * cached snapshot. Callers that hold whole contexts should use
 * {@link syncContextsWithLiveItems} instead.
 */
export async function syncCitesWithLiveItems(cites: Cite[]): Promise<Cite[]> {
  return Promise.all(cites.map((cite) => resolveCiteWithLiveItem(cite)));
}

/**
 * Re-fetch live item data for whole citation contexts, before they reach the
 * sandbox. Resolving up front means both the generated output and the
 * `citations[].source` returned to the front-end carry the surviving item
 * identities, so the front-end can replace the stale URIs stored in the
 * document instead of reporting them as inaccessible on every refresh.
 *
 * @param contexts - Citation contexts as received from the front-end
 * @param importedItems - Items imported during this refresh, keyed by the URI
 *   they replace
 * @returns Contexts with `cites[].item` refreshed from the live library
 */
export async function syncContextsWithLiveItems(
  contexts: CitationContext[],
  importedItems?: Map<string, Zotero.Item>,
): Promise<CitationContext[]> {
  return Promise.all(
    contexts.map(async (context) => ({
      ...context,
      cites: await Promise.all(
        context.cites.map((cite) =>
          resolveCiteWithLiveItem(cite, importedItems),
        ),
      ),
    })),
  );
}

export function isBanyanItem(value: unknown): value is Item | ScriptItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === "number" && typeof record.itemType === "string";
}

export function getItemFieldText(item: Item, field: string): string {
  const v = item[field];
  return typeof v === "string" ? v : "";
}

export function getItemFirstCreatorName(item: Item): string {
  const creator = item.creators?.[0];
  if (!creator) {
    return "";
  }
  if ("lastName" in creator && creator.lastName) {
    return creator.lastName;
  }
  if ("name" in creator && creator.name) {
    return creator.name;
  }
  return "";
}

/**
 * User-friendly display label for an item, matching the citation dialog
 * bubble: first creator's name plus date when available, falling back to
 * the item title (or "Untitled").
 */
export function getItemDisplayLabel(item: Item): string {
  const creator = getItemFirstCreatorName(item);
  const date = typeof item.date === "string" && item.date ? item.date : "";
  const label = [creator, date].filter(Boolean).join(", ");
  if (label) {
    return label;
  }
  return typeof item.title === "string" && item.title ? item.title : "Untitled";
}
