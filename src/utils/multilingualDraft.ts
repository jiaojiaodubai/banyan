import type {
  CreatorSnapshot,
  ItemContentSnapshot,
} from "../../typings/multilingualItem";
import { normalizeLanguageCode } from "@banyan/core/items/language";

export type LanguageItemCandidate<T> = {
  item: T;
  language: unknown;
  deleted?: boolean;
};

/** Find a live item with the same canonical language tag, source or copy. */
export function findExistingLanguageItem<T extends { id: number }>(
  items: readonly LanguageItemCandidate<T>[],
  language: string,
): T | null {
  const normalizedLanguage = normalizeLanguageCode(language);
  if (!normalizedLanguage) {
    return null;
  }

  return (
    items
      .filter(
        (candidate) =>
          !candidate.deleted &&
          normalizeLanguageCode(candidate.language) === normalizedLanguage,
      )
      .sort((a, b) => a.item.id - b.item.id)[0]?.item ?? null
  );
}

/** `https://doi.org/...` URL for a DOI value, or null if malformed. */
export function doiToUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const doi = value
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "");
  if (!/^10\.\d{4,9}\/\S+$/.test(doi)) {
    return null;
  }
  return `https://doi.org/${escapeDoi(doi)}`;
}

// The item pane encodes the same characters (`itemBox.js`). `%` first so these
// escapes survive; `#`/`?` would truncate the URL at doi.org, while `/` is
// valid in a DOI and stays.
const DOI_ESCAPE_PATTERN = /[%#?"]/g;
const DOI_ESCAPES: Record<string, string> = {
  "%": "%25",
  "#": "%23",
  "?": "%3f",
  '"': "%22",
};

function escapeDoi(doi: string): string {
  return doi.replace(DOI_ESCAPE_PATTERN, (char) => DOI_ESCAPES[char]);
}

export function hasNonLanguageChanges(
  sourceFields: Readonly<Record<string, string>>,
  draftFields: Readonly<Record<string, string>>,
  sourceCreators: readonly CreatorSnapshot[],
  draftCreators: readonly CreatorSnapshot[],
): boolean {
  const fieldNames = new Set([
    ...Object.keys(sourceFields),
    ...Object.keys(draftFields),
  ]);

  for (const fieldName of fieldNames) {
    if (fieldName === "language") {
      continue;
    }
    if ((sourceFields[fieldName] ?? "") !== (draftFields[fieldName] ?? "")) {
      return true;
    }
  }

  return JSON.stringify(sourceCreators) !== JSON.stringify(draftCreators);
}

export function filterComparableFields(
  fields: Readonly<Record<string, string>>,
): Record<string, string> {
  const comparable: Record<string, string> = {};
  for (const [field, value] of Object.entries(fields)) {
    if (field !== "abstractNote") {
      comparable[field] = value;
    }
  }
  return comparable;
}

/** Field values of an item's type, minus the ones a copy never takes over. */
export function getComparableFields(item: Zotero.Item): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const fieldID of Zotero.ItemFields.getItemTypeFields(item.itemTypeID)) {
    const field = Zotero.ItemFields.getName(fieldID);
    if (field) {
      fields[field] = item.getField(field);
    }
  }
  return filterComparableFields(fields);
}

export function getCreatorSnapshots(item: Zotero.Item): CreatorSnapshot[] {
  return item.getCreators().map((creator) => ({
    creatorTypeID: creator.creatorTypeID,
    fieldMode: creator.fieldMode,
    firstName: creator.firstName,
    lastName: creator.lastName,
  }));
}

/** Snapshot comparable content; both realms build snapshots through this. */
export function snapshotItemContent(item: Zotero.Item): ItemContentSnapshot {
  return {
    libraryID: item.libraryID,
    itemTypeID: item.itemTypeID,
    fields: getComparableFields(item),
    creators: getCreatorSnapshots(item),
  };
}

export function isSameItemContent(
  before: ItemContentSnapshot,
  after: ItemContentSnapshot,
): boolean {
  return (
    before.libraryID === after.libraryID &&
    before.itemTypeID === after.itemTypeID &&
    JSON.stringify(before.fields) === JSON.stringify(after.fields) &&
    JSON.stringify(before.creators) === JSON.stringify(after.creators)
  );
}

/** Re-read content from the database. `loadDataType()` always queries, so a
 * following `reload()` would only read the same rows a second time. */
export async function reloadItemContent(item: Zotero.Item): Promise<void> {
  for (const dataType of ["primaryData", "itemData", "creators"]) {
    await item.loadDataType(dataType);
  }
}
