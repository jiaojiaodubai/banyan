import type {
  ConvertFieldInput,
  ConvertRequestData,
  ConvertResponseData,
} from "../../typings/server";
import type { Creator, Item } from "../../typings/item";
import type { TextUnit } from "../../typings/unit";
import type {
  CitationParams,
  CitationSource,
  IntextCitation,
  NoteCitation,
} from "../../typings/style";
import { toBanyanItem } from "../utils/item";

type ConvertStatus = "ok" | "fallback" | "error";

type NormalizedCitationItem = {
  id?: number;
  uris: string[];
  itemData?: Record<string, unknown>;
  locator?: string;
  label?: string;
  prefix?: string;
  suffix?: string;
  [key: string]: unknown;
};

type NormalizedCitationPayload = {
  citationItems: NormalizedCitationItem[];
  properties: Record<string, unknown>;
};

type ParsedFieldCode =
  | { ok: true; value: unknown }
  | { ok: false; message: string };

type ConvertedFieldBase = {
  status: ConvertStatus;
  source: CitationSource;
  units: TextUnit[];
  message?: string;
};

const EMPTY_SOURCE: CitationSource = {
  cites: [],
  params: {
    sortBy: "cite",
    prefix: "",
    suffix: "",
  },
};
export async function convertCitationFields(
  request: ConvertRequestData,
): Promise<ConvertResponseData> {
  const fields = request.fields;

  if (request.citationType === "intext-citation") {
    const mapped: Record<string, IntextCitation> = {};

    for (const field of fields) {
      const converted = await convertSingleField(field);
      mapped[field.fieldId] = {
        id: generateCitationId(),
        type: "intext-citation",
        source: converted.source,
        units: converted.units,
      };
      logConvertedFieldStatus(field.fieldId, converted);
    }

    return mapped;
  }

  const mapped: Record<string, NoteCitation> = {};

  for (const field of fields) {
    const converted = await convertSingleField(field);
    mapped[field.fieldId] = {
      id: generateCitationId(),
      type: "note-citation",
      source: converted.source,
      units: converted.units,
      reference: [],
    };
    logConvertedFieldStatus(field.fieldId, converted);
  }

  return mapped;
}

async function convertSingleField(
  field: ConvertFieldInput,
): Promise<ConvertedFieldBase> {
  const parsed = parseCitationFieldCode(field.fieldCode);
  if (!parsed.ok) {
    return buildErrorResult(parsed.message);
  }

  const citation = normalizeCitationPayload(parsed.value);
  if (citation.citationItems.length === 0) {
    return buildErrorResult("citationItems is missing or empty");
  }

  const cites: CitationSource["cites"] = [];
  let usedFallback = false;

  for (let index = 0; index < citation.citationItems.length; index++) {
    const citationItem = citation.citationItems[index];
    const resolved = await resolveCitationItem(
      citationItem,
      field.fieldId,
      index,
    );

    if (!resolved.item) {
      return buildErrorResult(
        resolved.warning || "No valid citation item could be restored",
      );
    }

    if (resolved.fallback) {
      usedFallback = true;
    }

    const params = buildCiteParams(citationItem);
    cites.push(
      Object.keys(params).length
        ? { item: resolved.item, params }
        : { item: resolved.item },
    );
  }

  const source: CitationSource = {
    cites,
    params: buildCitationParams(citation.properties),
  };

  const renderedText = extractRenderedText(citation.properties);
  const units = renderedText
    ? [{ value: renderedText }]
    : [{ value: "Converted citation has no stored display text" }];

  return {
    status: usedFallback ? "fallback" : "ok",
    source,
    units,
    message: usedFallback
      ? "Used embedded CSL itemData for at least one citation item"
      : undefined,
  };
}

function parseCitationFieldCode(fieldCode: string): ParsedFieldCode {
  const json = extractJSONObject(fieldCode);
  if (!json) {
    return {
      ok: false,
      message: "Cannot find JSON payload in fieldCode",
    };
  }

  try {
    return { ok: true, value: JSON.parse(json) };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error
          ? `Failed to parse citation JSON: ${e.message}`
          : "Failed to parse citation JSON",
    };
  }
}

function extractJSONObject(fieldCode: string): string | null {
  if (typeof fieldCode !== "string") {
    return null;
  }

  const start = fieldCode.indexOf("{");
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < fieldCode.length; i++) {
    const ch = fieldCode[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (ch === "{") {
      depth += 1;
      continue;
    }

    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return fieldCode.slice(start, i + 1);
      }
    }
  }

  return null;
}

function normalizeCitationPayload(raw: unknown): NormalizedCitationPayload {
  const source = isObject(raw) ? raw : {};
  const citationItemsRaw =
    source.citationItems ?? source.CITATIONITEMS ?? source.citationitems;

  const citationItems: NormalizedCitationItem[] = Array.isArray(
    citationItemsRaw,
  )
    ? citationItemsRaw.map((rawItem) => normalizeCitationItem(rawItem))
    : [];

  const properties = isObject(source.properties) ? source.properties : {};

  return {
    citationItems,
    properties,
  };
}

function normalizeCitationItem(raw: unknown): NormalizedCitationItem {
  const source = isObject(raw) ? raw : {};
  const id = toPositiveNumber(source.id ?? source.itemID ?? source.ITEMID);
  const uriArray = normalizeUriArray(source.uris ?? source.uri ?? source.URI);

  const itemData = isObject(source.itemData)
    ? source.itemData
    : isObject(source.ITEMDATA)
      ? source.ITEMDATA
      : undefined;

  const out: NormalizedCitationItem = {
    ...source,
    id,
    uris: uriArray,
    itemData,
  };

  if (typeof source.locator === "string") out.locator = source.locator;
  if (typeof source.label === "string") out.label = source.label;
  if (typeof source.prefix === "string") out.prefix = source.prefix;
  if (typeof source.suffix === "string") out.suffix = source.suffix;

  return out;
}

async function resolveCitationItem(
  citationItem: NormalizedCitationItem,
  fieldId: string,
  index: number,
): Promise<{ item: Item | null; fallback: boolean; warning?: string }> {
  const primaryUri = citationItem.uris[0];
  const zoteroItem = await getItemWithMergeFallback(
    citationItem.id,
    primaryUri,
  );
  if (zoteroItem) {
    return { item: toBanyanItem(zoteroItem), fallback: false };
  }

  if (citationItem.itemData) {
    return {
      item: buildItemFromCSLData(
        citationItem.itemData,
        citationItem,
        `${fieldId}:${index}`,
      ),
      fallback: true,
      warning: `Using embedded CSL itemData for ${primaryUri || `cite-${index + 1}`}`,
    };
  }

  return {
    item: null,
    fallback: true,
    warning: `Cannot restore citation item ${primaryUri || `cite-${index + 1}`}`,
  };
}

async function getItemWithMergeFallback(
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
      // Continue to fallback checks.
    }

    try {
      const replacers = await Zotero.Relations.getByPredicateAndObject(
        "item",
        Zotero.Relations.replacedItemPredicate,
        itemUri,
      );
      if (replacers.length && !replacers[0].deleted) {
        return replacers[0];
      }
    } catch {
      // Continue to ID fallback.
    }
  }

  if (itemId && Number.isFinite(itemId) && itemId > 0) {
    try {
      const item = await Zotero.Items.getAsync(itemId);
      if (item && !item.deleted) {
        return item;
      }
    } catch {
      // No-op
    }
  }

  return null;
}

function buildCiteParams(
  citationItem: NormalizedCitationItem,
): Record<string, string | boolean> {
  const params: Record<string, string | boolean> = {};
  const keys = [
    "locator",
    "label",
    "prefix",
    "suffix",
    "position",
    "nearNote",
    "suppress-author",
    "author-only",
    "composite",
  ] as const;

  for (const key of keys) {
    const value = citationItem[key];
    if (typeof value === "string" || typeof value === "boolean") {
      params[key] = value;
    }
  }

  return params;
}

function buildCitationParams(
  properties: Record<string, unknown>,
): CitationParams {
  const params: CitationParams = {};

  for (const [key, value] of Object.entries(properties)) {
    if (typeof value === "string" || typeof value === "boolean") {
      params[key] = value;
    }
  }

  return params;
}

function extractRenderedText(properties: Record<string, unknown>): string {
  const custom = asString(properties.custom).trim();
  if (custom) return custom;

  const plainCitation = asString(properties.plainCitation).trim();
  if (plainCitation) return plainCitation;

  const formattedCitation = asString(properties.formattedCitation).trim();
  if (!formattedCitation) return "";

  const stripped = stripRtf(formattedCitation).trim();
  return stripped || formattedCitation;
}

function stripRtf(text: string): string {
  if (!text.includes("\\")) {
    return text;
  }

  return text
    .replace(/\\par[d]?/g, "\n")
    .replace(/\\'[0-9a-fA-F]{2}/g, "")
    .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ");
}

function buildErrorResult(message: string): ConvertedFieldBase {
  return {
    status: "error",
    source: {
      cites: [],
      params: { ...EMPTY_SOURCE.params },
    },
    units: [
      { value: `Converted citation has no stored display text: ${message}` },
    ],
    message,
  };
}

function logConvertedFieldStatus(
  fieldId: string,
  converted: ConvertedFieldBase,
): void {
  if (converted.status === "error") {
    ztoolkit.logError(
      `[converter] field.convert.error fieldId=${fieldId} message=${converted.message || "unknown_error"}`,
    );
    return;
  }
}

function generateCitationId(): string {
  const randomString = (Zotero.Utilities as { randomString?: () => string })
    .randomString;
  if (typeof randomString === "function") {
    return randomString();
  }
  return `bn_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildItemFromCSLData(
  itemData: Record<string, unknown>,
  citationItem: NormalizedCitationItem,
  seed: string,
): Item {
  const id = citationItem.id ?? hashToPositiveInt(seed);
  const uri = citationItem.uris[0] || `csl://embedded/${id}`;

  const creators = parseCreatorsFromCSL(itemData);

  const title = asString(itemData.title) || "Untitled";
  const year = parseCSLYear(itemData.issued);

  const out = {
    id,
    uri,
    key: deriveItemKey(uri, id),
    itemType: "document",
    title,
    creators,
  } as unknown as Item;

  if (year) {
    out.year = year;
  }

  if (typeof itemData.publisher === "string") {
    out.publisher = itemData.publisher;
  }
  if (typeof itemData["container-title"] === "string") {
    out.publicationTitle = itemData["container-title"];
  }
  if (typeof itemData.volume === "string") {
    out.volume = itemData.volume;
  }
  if (typeof itemData.issue === "string") {
    out.issue = itemData.issue;
  }
  if (typeof itemData.page === "string") {
    out.pages = itemData.page;
  }
  if (typeof itemData.DOI === "string") {
    out.DOI = itemData.DOI;
  }

  return out;
}

type FallbackCreatorType = "author" | "editor" | "translator";

function parseCreatorsFromCSL(
  itemData: Record<string, unknown>,
): Creator<FallbackCreatorType>[] {
  const creatorBuckets: FallbackCreatorType[] = [
    "author",
    "editor",
    "translator",
  ];
  const creators: Creator<FallbackCreatorType>[] = [];

  for (const bucket of creatorBuckets) {
    const raw = itemData[bucket];
    if (!Array.isArray(raw)) continue;

    for (const person of raw) {
      if (!isObject(person)) continue;

      const literal = asString(person.literal);
      const given = asString(person.given);
      const family = asString(person.family);

      if (literal) {
        creators.push({
          creatorType: bucket,
          name: literal,
        });
      } else if (family || given) {
        creators.push({
          creatorType: bucket,
          firstName: given,
          lastName: family || given,
        });
      }
    }
  }

  return creators;
}

function parseCSLYear(issued: unknown): string | undefined {
  if (!isObject(issued)) {
    return undefined;
  }

  const dateParts = issued["date-parts"];
  if (!Array.isArray(dateParts) || !Array.isArray(dateParts[0])) {
    return undefined;
  }

  const year = dateParts[0][0];
  return typeof year === "number" || typeof year === "string"
    ? String(year)
    : undefined;
}

function deriveItemKey(uri: string, id: number): string {
  const parts = uri.split("/");
  const key = parts[parts.length - 1];
  if (key && key.length > 0 && key !== "items") {
    return key;
  }
  return `EMBEDDED_${id}`;
}

function normalizeUriArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    );
  }
  if (typeof value === "string" && value.length > 0) {
    return [value];
  }
  return [];
}

function toPositiveNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

function hashToPositiveInt(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const positive = Math.abs(hash);
  return positive === 0 ? 1 : positive;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}
