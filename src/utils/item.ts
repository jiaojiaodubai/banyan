import type { ExtraMap, Item } from "../../typings/item";
import type { ScriptItem } from "../../typings/style";

type ItemFieldsBaseMapper = Pick<
  _ZoteroTypes.ItemFields,
  "getID" | "getBaseIDFromTypeAndField" | "getName"
>;

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

function parseExtra(extraText: string): ExtraMap {
  const out: ExtraMap = {};
  const text = typeof extraText === "string" ? extraText : "";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    // Translate-like format: "key: value" (first ":" separates)
    const idx = line.indexOf(":");
    if (idx <= 0) continue;

    const key = normalizeExtraKey(line.slice(0, idx));
    const value = line.slice(idx + 1).trim();
    if (!key) continue;

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
