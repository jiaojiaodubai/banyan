import type {
  Creator,
  CreatorExtField,
  CreatorExtFields,
  CreatorExtRecord,
  ExtraMap,
  Item,
} from "../../typings/item";
import type { Cite, CitationContext, ScriptItem } from "../../typings/style";
import { getReplacingItemForURI } from "./uri";
import { createLogger } from "./logger";

const log = createLogger("item");

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

export type ParsedCreatorExtRecord = {
  lineIndex: number;
  record: CreatorExtRecord;
};

export type CreatorExtParseIssue = {
  lineIndex: number;
  message: string;
};

export type CreatorExtParseResult = {
  records: ParsedCreatorExtRecord[];
  issues: CreatorExtParseIssue[];
};

export type CreatorExtReconciliationResult = {
  bindings: Map<number, CreatorExtFields>;
  issues: string[];
  unmatchedRecordLineIndexes: number[];
};

/** `extra` key holding the records: one JSON object per line. */
export const CREATORS_EXT_KEY = "creators-ext";

/** Extension fields, in the window's field order. */
export const CREATOR_EXT_FIELDS = [
  "role",
  "nationality",
  "dynasty",
] as const satisfies readonly CreatorExtField[];

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

export function parseCreatorsExt(
  extra: ExtraMap | undefined,
): CreatorExtParseResult {
  const value = extra?.[CREATORS_EXT_KEY];
  const lines =
    typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  const records: ParsedCreatorExtRecord[] = [];
  const issues: CreatorExtParseIssue[] = [];

  for (const [lineIndex, line] of lines.entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      // Malformed lines are expected: `extra` is user-editable and older
      // writers may have used another format.
      issues.push({
        lineIndex,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      issues.push({ lineIndex, message: "Record must be a JSON object" });
      continue;
    }

    const record = parsed as Record<string, unknown>;
    const validCreatorType =
      record.creatorType === undefined ||
      typeof record.creatorType === "string";
    const validFieldMode =
      record.fieldMode === undefined ||
      record.fieldMode === 0 ||
      record.fieldMode === 1;
    const validIndex =
      record.index === undefined ||
      (typeof record.index === "number" &&
        Number.isInteger(record.index) &&
        record.index >= 0);
    const validNames = ["firstName", "lastName", "name"].every(
      (key) => record[key] === undefined || typeof record[key] === "string",
    );
    const validExtensions = CREATOR_EXT_FIELDS.every(
      (key) => record[key] === undefined || typeof record[key] === "string",
    );
    const hasExtension = CREATOR_EXT_FIELDS.some(
      (key) => typeof record[key] === "string",
    );

    if (
      !validCreatorType ||
      !validFieldMode ||
      !validIndex ||
      !validNames ||
      !validExtensions ||
      !hasExtension
    ) {
      issues.push({
        lineIndex,
        message: "Record does not match the creators-ext schema",
      });
      continue;
    }

    // Identity must be complete: a lone name part cannot identify anyone, and
    // carrying both forms is contradictory. Reject rather than match.
    const hasSingleName = typeof record.name === "string";
    const hasBothNameParts =
      typeof record.firstName === "string" &&
      typeof record.lastName === "string";
    const hasPartialNameParts =
      (record.firstName !== undefined || record.lastName !== undefined) &&
      !hasBothNameParts;
    const hasConflictingIdentity =
      hasSingleName &&
      (record.firstName !== undefined || record.lastName !== undefined);

    if (hasPartialNameParts || hasConflictingIdentity) {
      issues.push({
        lineIndex,
        message:
          "Record must identify its creator by `name`, or by both `firstName` and `lastName`",
      });
      continue;
    }

    records.push({
      lineIndex,
      record: record as CreatorExtRecord,
    });
  }

  return { records, issues };
}

/**
 * Identity match requires the same creator type and the same name mode, so a
 * stale record cannot capture an unrelated creator. The window's reload path
 * carries values over by the same rule.
 */
export function creatorMatchesExtIdentity(
  creator: Creator,
  record: CreatorExtRecord,
): boolean {
  if (!record.creatorType || creator.creatorType !== record.creatorType) {
    return false;
  }

  if (typeof record.name === "string") {
    return "name" in creator && creator.name === record.name;
  }

  if (
    typeof record.firstName === "string" &&
    typeof record.lastName === "string"
  ) {
    return (
      "firstName" in creator &&
      creator.firstName === record.firstName &&
      creator.lastName === record.lastName
    );
  }

  return false;
}

function createCreatorExtFields(record: CreatorExtRecord): CreatorExtFields {
  const fields: CreatorExtFields = {};
  for (const key of CREATOR_EXT_FIELDS) {
    const value = record[key];
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  return fields;
}

/** Whether the record carries a complete name identity (see `parseCreatorsExt`). */
function hasNameIdentity(record: CreatorExtRecord): boolean {
  return (
    typeof record.name === "string" ||
    (typeof record.firstName === "string" &&
      typeof record.lastName === "string")
  );
}

/**
 * Creator to fall back to by position, or undefined: a record that claims an
 * `index` is taken at its word, one that never had any gets the first free
 * creator of the recorded type.
 */
function findCreatorByPosition(
  record: CreatorExtRecord,
  creators: readonly Creator[],
  matched: ReadonlySet<number>,
): number | undefined {
  const typeMatches = (creator: Creator): boolean =>
    !record.creatorType || creator.creatorType === record.creatorType;

  if (typeof record.index === "number") {
    const creator = creators[record.index];
    return creator && !matched.has(record.index) && typeMatches(creator)
      ? record.index
      : undefined;
  }

  const index = creators.findIndex(
    (creator, position) => !matched.has(position) && typeMatches(creator),
  );
  return index < 0 ? undefined : index;
}

/**
 * Match records to creators by identity, then by the record's `index`, then by
 * row order; the last two apply only while the recorded positions still hold,
 * so a stale record stays unmatched instead of binding to whoever moved into
 * its slot.
 */
export function reconcileCreatorsExt(
  records: readonly ParsedCreatorExtRecord[],
  creators: readonly Creator[],
): CreatorExtReconciliationResult {
  const bindings = new Map<number, CreatorExtFields>();
  const issues: string[] = [];
  const matched = new Set<number>();
  const matchedRecordLineIndexes = new Set<number>();
  const unresolved: ParsedCreatorExtRecord[] = [];
  let positionsTrusted = true;

  // Identity first, so the position fallbacks cannot take a creator that some
  // record still claims by name.
  for (const { lineIndex, record } of records) {
    const identity = creators
      .map((creator, index) => ({ creator, index }))
      .filter(
        ({ creator, index }) =>
          !matched.has(index) && creatorMatchesExtIdentity(creator, record),
      );

    let creatorIndex: number | undefined;
    if (identity.length === 1) {
      creatorIndex = identity[0].index;
    } else if (identity.length > 1) {
      const indexed = identity.find(({ index }) => index === record.index);
      if (indexed) {
        creatorIndex = indexed.index;
      } else {
        issues.push(
          `Record ${lineIndex + 1} has an ambiguous creator identity`,
        );
        continue;
      }
    }

    if (creatorIndex === undefined) {
      unresolved.push({ lineIndex, record });
      continue;
    }

    if (typeof record.index === "number" && record.index !== creatorIndex) {
      positionsTrusted = false;
    }

    matched.add(creatorIndex);
    matchedRecordLineIndexes.add(lineIndex);
    bindings.set(creatorIndex, createCreatorExtFields(record));
  }

  for (const { lineIndex, record } of unresolved) {
    // Row order is only evidence for a record that claims nothing at all; a
    // failed identity must not silently become a position guess.
    const hasEvidence =
      typeof record.index === "number" || !hasNameIdentity(record);
    const creatorIndex =
      positionsTrusted && hasEvidence
        ? findCreatorByPosition(record, creators, matched)
        : undefined;

    if (creatorIndex === undefined) {
      continue;
    }

    matched.add(creatorIndex);
    matchedRecordLineIndexes.add(lineIndex);
    bindings.set(creatorIndex, createCreatorExtFields(record));
  }

  if (!positionsTrusted) {
    issues.push(
      "Recorded creator positions no longer match the item, so position fallback was skipped",
    );
  }
  for (const { lineIndex } of unresolved) {
    if (!matchedRecordLineIndexes.has(lineIndex)) {
      issues.push(`Record ${lineIndex + 1} could not be matched to a creator`);
    }
  }

  return {
    bindings,
    issues,
    unmatchedRecordLineIndexes: records
      .filter(({ lineIndex }) => !matchedRecordLineIndexes.has(lineIndex))
      .map(({ lineIndex }) => lineIndex),
  };
}

export function bindCreatorsExt(
  item: Item,
  report: (message: string) => void = (message) => log.warn(message),
): void {
  const parsed = parseCreatorsExt(item.extra);
  const reconciled = reconcileCreatorsExt(parsed.records, item.creators);

  for (const issue of parsed.issues) {
    report(
      `Invalid creators-ext record ${issue.lineIndex + 1}: ${issue.message}`,
    );
  }
  for (const issue of reconciled.issues) {
    report(`Invalid creators-ext data: ${issue}`);
  }

  for (const [index, fields] of reconciled.bindings) {
    Object.assign(item.creators[index], fields);
  }
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
  bindCreatorsExt(json as Item);

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
    log.error("Failed to refresh the cited item", e);
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
