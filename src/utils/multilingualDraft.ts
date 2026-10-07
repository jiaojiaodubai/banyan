import type {
  CreatorSnapshot,
  ItemContentSnapshot,
} from "../../typings/multilingualItem";

export type LanguageItemCandidate<T> = {
  item: T;
  language: unknown;
  deleted?: boolean;
};

/** Normalized language of one item; `isSource` outranks related copies. */
export type StyleLanguageCandidate<T> = {
  item: T;
  /** Leniently normalized tag; never empty (items without one are dropped). */
  language: string;
  isSource?: boolean;
};

const LANGUAGE_TAG_PATTERN =
  /^([a-z]{2,8})(?:-([a-z]{4}))?(?:-([a-z]{2}|[0-9]{3}))?$/i;
const NON_COUNTRY_ALPHA_REGION_CODES = new Set([
  "AC",
  "CP",
  "DG",
  "EA",
  "EU",
  "EZ",
  "IC",
  "QO",
  "UN",
  "XA",
  "XB",
]);
const NON_COUNTRY_NUMERIC_REGION_CODES = new Set([
  "001",
  "002",
  "003",
  "005",
  "009",
  "011",
  "013",
  "014",
  "015",
  "017",
  "018",
  "019",
  "021",
  "029",
  "030",
  "034",
  "035",
  "039",
  "053",
  "054",
  "057",
  "061",
  "142",
  "143",
  "145",
  "150",
  "151",
  "154",
  "155",
  "202",
]);

// Constructing `Intl.DisplayNames` dominates this hot path (once per reference
// per lookup), so the formatters and results are cached for the session.
let languageDisplayNames: Intl.DisplayNames | null = null;
let scriptDisplayNames: Intl.DisplayNames | null = null;
let regionDisplayNames: Intl.DisplayNames | null = null;
const validatedLanguageTags = new Map<string, string | null>();
const styleLanguageTags = new Map<string, string>();

function getDisplayNames(
  type: "language" | "script" | "region",
): Intl.DisplayNames {
  if (type === "language") {
    languageDisplayNames ??= new Intl.DisplayNames(["en"], { type });
    return languageDisplayNames;
  }
  if (type === "script") {
    scriptDisplayNames ??= new Intl.DisplayNames(["en"], { type });
    return scriptDisplayNames;
  }
  regionDisplayNames ??= new Intl.DisplayNames(["en"], { type });
  return regionDisplayNames;
}

/** Strict BCP 47 for dialog input; memoized, rejects tags with no data. */
export function normalizeLanguageCode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const languageCode = value.trim().replace(/_/g, "-");
  if (!languageCode) {
    return null;
  }
  const cached = validatedLanguageTags.get(languageCode);
  if (cached !== undefined) {
    return cached;
  }
  const normalized = validateLanguageTag(languageCode);
  validatedLanguageTags.set(languageCode, normalized);
  return normalized;
}

function validateLanguageTag(languageCode: string): string | null {
  const match = LANGUAGE_TAG_PATTERN.exec(languageCode);
  if (!match) {
    return null;
  }

  try {
    const locale = new Intl.Locale(languageCode);
    const languageName = getDisplayNames("language").of(locale.language);
    if (
      !languageName ||
      languageName.toLowerCase() === locale.language ||
      /unknown language/i.test(languageName)
    ) {
      return null;
    }

    if (match[2]) {
      const script = locale.script ?? "";
      const scriptName = getDisplayNames("script").of(script);
      if (
        !scriptName ||
        scriptName.toLowerCase() === script.toLowerCase() ||
        /unknown script/i.test(scriptName)
      ) {
        return null;
      }
    }

    if (match[3]) {
      const region = locale.region ?? "";
      const regionName = getDisplayNames("region").of(region);
      if (
        !regionName ||
        regionName.toLowerCase() === region.toLowerCase() ||
        /unknown region/i.test(regionName) ||
        (/^[a-z]{2}$/i.test(region) &&
          NON_COUNTRY_ALPHA_REGION_CODES.has(region.toUpperCase())) ||
        NON_COUNTRY_NUMERIC_REGION_CODES.has(region)
      ) {
        return null;
      }
    }

    return locale.toString();
  } catch {
    return null;
  }
}

/** Lenient BCP 47 for lookups; never rejects a tag, unlike the strict one. */
export function normalizeStyleLanguageTag(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const languageCode = String(value).trim().replace(/_/g, "-").toLowerCase();
  if (!languageCode) {
    return "";
  }
  const cached = styleLanguageTags.get(languageCode);
  if (cached !== undefined) {
    return cached;
  }
  let normalized = languageCode;
  try {
    normalized = new Intl.Locale(languageCode).toString().toLowerCase();
  } catch {
    // Keep the textual form; the prefix rule still compares it as written.
  }
  styleLanguageTags.set(languageCode, normalized);
  return normalized;
}

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

/**
 * Best match among already-normalized candidates: exact canonical tag first,
 * then the legacy prefix rule (`zh` ↔ `zh-CN`); ties break by source, tag, ID.
 */
export function findLanguageMatch<T extends { id: number }>(
  candidates: readonly StyleLanguageCandidate<T>[],
  preference: string,
): T | null {
  const normalizedPreference = normalizeStyleLanguageTag(preference);
  if (!normalizedPreference) {
    return null;
  }

  const exact = candidates.filter(
    (candidate) => candidate.language === normalizedPreference,
  );
  const pool = exact.length
    ? exact
    : candidates.filter(
        (candidate) =>
          candidate.language.startsWith(`${normalizedPreference}-`) ||
          normalizedPreference.startsWith(`${candidate.language}-`),
      );
  if (!pool.length) {
    return null;
  }

  let best = pool[0];
  for (const candidate of pool) {
    if (isBetterStyleMatch(candidate, best)) {
      best = candidate;
    }
  }
  return best.item;
}

function isBetterStyleMatch<T extends { id: number }>(
  candidate: StyleLanguageCandidate<T>,
  current: StyleLanguageCandidate<T>,
): boolean {
  if (Boolean(candidate.isSource) !== Boolean(current.isSource)) {
    return Boolean(candidate.isSource);
  }
  if (candidate.language !== current.language) {
    return candidate.language < current.language;
  }
  return candidate.item.id < current.item.id;
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

export type CreatorName = {
  /** 0 = separate last/first name, 1 = a single field. */
  fieldMode: 0 | 1;
  firstName: string;
  lastName: string;
};

/**
 * Change how a creator's name is stored, keeping the text the user sees.
 * Mirrors `itemBox.switchCreatorMode()`; the last word stays the last name.
 */
export function switchCreatorNameMode(
  name: CreatorName,
  fieldMode: 0 | 1,
): CreatorName {
  if (fieldMode === name.fieldMode) {
    return { ...name };
  }
  if (fieldMode === 1) {
    const combined = name.firstName
      ? `${name.firstName} ${name.lastName}`
      : name.lastName;
    return { fieldMode: 1, firstName: "", lastName: combined };
  }
  const parts = /(.*?)[ ]*([^ ]+[ ]*)$/.exec(name.lastName);
  if (parts?.[2] && parts[2] !== name.lastName) {
    return { fieldMode: 0, firstName: parts[1], lastName: parts[2] };
  }
  return { fieldMode: 0, firstName: "", lastName: name.lastName };
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
