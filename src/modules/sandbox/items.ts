/**
 * Zotero-side item conversion: live `Zotero.Item` -> Banyan `Item`, plus
 * re-resolution against the live library. The record conventions are the
 * core's `items/*` contract.
 */
import type { Item } from "@banyan/core/types/item";
import type {
  Cite,
  CitationContext,
  ScriptItem,
} from "@banyan/core/types/style";
import { bindCreatorsExt } from "@banyan/core/items/creatorsExt";
import { parseExtraMap } from "@banyan/core/items/extra";
import {
  assignBaseFieldAliases,
  stripExcludedFields,
} from "@banyan/core/items/fields";
import { getReplacingItemForURI } from "../../utils/uri";
import { decodeZoteroItemId } from "../../utils/itemHandle";
import { createLogger } from "../../utils/logger";

const log = createLogger("sandbox.items");

/**
 * Zotero-private durable item reference. `z:` is the host namespace: the core
 * does not define this key, and styles should not depend on it.
 */
export const ZOTERO_ITEM_URI_KEY = "z:uri" as const;

export type ZoteroBanyanItem = Item & { [ZOTERO_ITEM_URI_KEY]: string };

/** Read the Zotero-private item URI from a style or host item. */
export function getZoteroItemUri(item: Item | ScriptItem): string {
  const value = (item as Record<string, unknown>)[ZOTERO_ITEM_URI_KEY];
  return typeof value === "string" ? value : "";
}

/**
 * Zotero's numeric itemID, decoded from a Banyan item's opaque string handle.
 * Returns undefined on failure: callers fall back to the `z:uri` path or keep
 * the cached snapshot.
 */
export function getZoteroItemId(item: Item | ScriptItem): number | undefined {
  return decodeZoteroItemId(item.id);
}

/**
 * Convert a live Zotero item into the Banyan item shape: the `extra` string
 * becomes a normalized map, `creators-ext` records are bound onto their
 * creators, and type-specific fields gain their base-field aliases.
 *
 * Host-only identity fields (`key`, `uri`, `relations`) are removed from the
 * item exposed to styles; the durable URI is carried under the Zotero-private
 * `z:uri` extension key.
 */
export function toBanyanItem(zoteroItem: Zotero.Item): ZoteroBanyanItem {
  const json = (zoteroItem.toJSON?.() ?? {}) as Record<string, unknown>;

  stripExcludedFields(json);
  assignBaseFieldAliases(String(json.itemType ?? ""), json);

  json.id = String(zoteroItem.id);
  json[ZOTERO_ITEM_URI_KEY] = Zotero.URI.getItemURI(zoteroItem);
  json.year = zoteroItem.getField("year");
  json.firstCreator = zoteroItem.firstCreator;

  // These belong to the host's record, not the item exposed to styles.
  delete json.key;
  delete json.uri;
  delete json.relations;

  // Parse extra (string) into structured map
  const extraText = typeof json.extra === "string" ? json.extra : "";
  json.extra = parseExtraMap(extraText);
  bindCreatorsExt(
    json as unknown as Pick<Item, "extra" | "creators">,
    (message) => log.warn(message),
  );

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

  return json as unknown as ZoteroBanyanItem;
}

/**
 * Resolve a Zotero item from a citation identity with fallback for merged
 * items. Implements the same lookup order as
 * Zotero.Integration.URIMap.prototype.getZoteroItemForURIs so that
 * duplicate-item merges resolve to the surviving item.
 *
 * @param itemId - The item ID from citation (optional)
 * @param itemUri - The Zotero item URI from citation (optional)
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
 * surviving item's id and `z:uri`, which is what replaces the stale identity
 * a document still holds after duplicates were merged or items were imported.
 */
async function resolveCiteWithLiveItem(
  cite: Cite,
  importedItems?: Map<string, Zotero.Item>,
): Promise<Cite> {
  try {
    const itemUri = getZoteroItemUri(cite.item);
    const imported = itemUri ? importedItems?.get(itemUri) : undefined;
    const item =
      imported ??
      (await getItemWithMergeFallback(getZoteroItemId(cite.item), itemUri));
    if (!item) {
      return cite;
    }
    return { ...cite, item: toBanyanItem(item) };
  } catch (e) {
    log.warn("实时条目解析失败，沿用缓存快照", e);
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
