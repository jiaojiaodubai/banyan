import { useL10n } from "../utils/locale";

const t = useL10n(["mainWindow.ftl"]);
// Relation prefix must match pattern /^[a-z]+:[a-z]+$/
export const prefix = "banyan:multilingual";

/**
 * The dialog throws instead of alerting: a plugin-realm alert is parented to
 * the main window and would be hidden behind the dialog that asked for it.
 */
type RelateErrorMode = "alert" | "throw";

function failRelate(messageID: string, mode: RelateErrorMode): false {
  if (mode === "throw") {
    throw new Error(t(messageID));
  }
  ztoolkit.getGlobal("alert")(t(messageID));
  return false;
}

export function getMultilingualUris(item: Zotero.Item): string[] {
  const relations = item.getRelations() as Record<string, string[]>;
  const uris = relations[prefix] ?? [];
  return uris;
}

export async function getMultilingualItems(
  item: Zotero.Item,
): Promise<Zotero.Item[]> {
  const seen = new Set<number>();
  const relItems = await Promise.all(
    getMultilingualUris(item).map((uri) => Zotero.URI.getURIItem(uri)),
  );

  // Trashed members are deliberately included so relating and unrelating keep
  // the group consistent; callers that must skip a deleted copy filter it, as
  // `getVisibleMultilingualItems` does.
  return relItems.filter((relItem): relItem is Zotero.Item => {
    if (!relItem?.id || relItem.id === item.id || seen.has(relItem.id)) {
      return false;
    }
    seen.add(relItem.id);
    return true;
  });
}

/**
 * Multilingual members a list should show, mirroring Zotero's related-items
 * box: trashed members are hidden unless the item itself is trashed, so a copy
 * in the trash can still show the rest of its group without cluttering every
 * live member's pane.
 */
export async function getVisibleMultilingualItems(
  item: Zotero.Item,
): Promise<Zotero.Item[]> {
  const relItems = await getMultilingualItems(item);
  return item.deleted
    ? relItems
    : relItems.filter((relItem) => !relItem.deleted);
}

/** Every item reachable from `items` through multilingual relations. */
export async function collectRelatableItems(
  items: Zotero.Item[],
  options: { refreshRelations?: boolean } = {},
): Promise<Zotero.Item[]> {
  const queue = [...items];
  const seen = new Set<number>();
  const relatableItems: Zotero.Item[] = [];

  for (let index = 0; index < queue.length; index++) {
    const item = queue[index];
    if (!item?.id || seen.has(item.id)) {
      continue;
    }

    seen.add(item.id);
    relatableItems.push(item);

    if (options.refreshRelations) {
      // Another window may have edited relations while a prompt is open; a
      // cached edge would hide a changed member.
      await item.loadDataType("relations");
      await item.reload(["relations"], true);
    }

    const relatedItems = await getMultilingualItems(item);
    for (const relatedItem of relatedItems) {
      if (!seen.has(relatedItem.id)) {
        queue.push(relatedItem);
      }
    }
  }

  return relatableItems;
}

function validateRelatableItems(
  items: Zotero.Item[],
  mode: RelateErrorMode,
): boolean {
  if (items.length < 2) {
    return true;
  }

  const baseItem = items[0];
  for (const item of items.slice(1)) {
    if (item.libraryID !== baseItem.libraryID) {
      return failRelate(
        "relate-multilingual-item-error-different-library",
        mode,
      );
    }
    if (item.itemType !== baseItem.itemType) {
      return failRelate(
        "relate-multilingual-item-error-different-item-type",
        mode,
      );
    }
  }

  return true;
}

/** What a relate run did; `skippedPairs` counts pairs left unlinked. */
export type RelateResult = {
  /** Items whose relations were saved, for callers that must recover state. */
  relatedItems: Zotero.Item[];
  skippedPairs: number;
};

/**
 * Link every item reachable from `items` to each other. Split out of
 * `relateItems()` because `Zotero.DB.executeTransaction()` cannot nest: a
 * caller that already runs in a transaction calls this directly.
 */
export async function relateItemsWithinTransaction(
  items: Zotero.Item[],
  options: { onError?: RelateErrorMode } = {},
): Promise<RelateResult> {
  const mode = options.onError ?? "alert";
  const saveOption = {
    skipDateModifiedUpdate: true,
  };
  // Validate only the named items; a member retyped or moved after linking is
  // repairable, so mismatched members are skipped pair by pair below.
  const namedItems = items.filter((item) => item?.id);
  if (namedItems.length < 2 || !validateRelatableItems(namedItems, mode)) {
    return { relatedItems: [], skippedPairs: 0 };
  }

  /* Compare to ZoteroPane.relateItems, we add deep relations between all items
   */
  const relatableItems = await collectRelatableItems(items);
  if (relatableItems.length < 2) {
    return { relatedItems: [], skippedPairs: 0 };
  }

  const ids = relatableItems.map((item) => item.id);
  const relatedItems = new Set<Zotero.Item>();
  let skippedPairs = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const item1 = Zotero.Items.get(ids[i]);
      const item2 = Zotero.Items.get(ids[j]);
      // Keep the rest of the group connected when one member cannot be.
      if (!canRelate(item1, item2)) {
        skippedPairs++;
        continue;
      }
      addRelatedItem(item1, item2);
      addRelatedItem(item2, item1);
      await item1.save(saveOption);
      await item2.save(saveOption);
      relatedItems.add(item1);
      relatedItems.add(item2);
    }
  }
  return { relatedItems: [...relatedItems], skippedPairs };
}

/**
 * Relate items as a standalone action (menu command, item-pane section). A
 * mismatched pair leaves the group split, so the user hears about it once.
 */
export async function relateItems(
  items: Zotero.Item[],
  options: { onError?: RelateErrorMode } = {},
): Promise<void> {
  const result = await Zotero.DB.executeTransaction(() =>
    relateItemsWithinTransaction(items, options),
  );
  if (result.skippedPairs > 0) {
    ztoolkit.getGlobal("alert")(
      t("relate-multilingual-item-warning-skipped", {
        args: { count: result.skippedPairs },
      }),
    );
  }
}

export async function unRelateItem(item: Zotero.Item) {
  const relItems = await getMultilingualItems(item);
  for (const relItem of relItems) {
    removeRelatedItem(item, relItem);
    removeRelatedItem(relItem, item);
    await item.save({ skipDateModifiedUpdate: true });
    await relItem.save({ skipDateModifiedUpdate: true });
  }
}

/** Whether two items may be linked; mismatched pairs are skipped, not fatal. */
function canRelate(item1: Zotero.Item, item2: Zotero.Item): boolean {
  return (
    item1.libraryID === item2.libraryID &&
    item1.itemType === item2.itemType &&
    item1.id !== item2.id
  );
}

// Reference to Zotero.Item.prototype.addRelatedItem
function addRelatedItem(item1: Zotero.Item, item2: Zotero.Item) {
  // @ts-expect-error Allowed custom relation prefixes
  return item1.addRelation(prefix, Zotero.URI.getItemURI(item2));
}

// Reference to Zotero.Item.prototype.removeRelatedItem
function removeRelatedItem(item1: Zotero.Item, item2: Zotero.Item) {
  // @ts-expect-error Allowed custom relation prefixes
  return item1.removeRelation(prefix, Zotero.URI.getItemURI(item2));
}
