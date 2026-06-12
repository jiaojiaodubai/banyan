import { useL10n } from "../utils/locale";

const t = useL10n(["mainWindow.ftl"]);
// Relation prefix must match pattern /^[a-z]+:[a-z]+$/
export const prefix = "banyan:multilingual";

function alertRelationError(messageID: string): void {
  ztoolkit.getGlobal("alert")(t(messageID));
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

  return relItems.filter((relItem): relItem is Zotero.Item => {
    if (!relItem?.id || relItem.id === item.id || seen.has(relItem.id)) {
      return false;
    }
    seen.add(relItem.id);
    return true;
  });
}

async function collectRelatableItems(
  items: Zotero.Item[],
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

    const relatedItems = await getMultilingualItems(item);
    for (const relatedItem of relatedItems) {
      if (!seen.has(relatedItem.id)) {
        queue.push(relatedItem);
      }
    }
  }

  return relatableItems;
}

function validateRelatableItems(items: Zotero.Item[]): boolean {
  if (items.length < 2) {
    return true;
  }

  const baseItem = items[0];
  for (const item of items.slice(1)) {
    if (item.libraryID !== baseItem.libraryID) {
      alertRelationError("relate-multilingual-item-error-different-library");
      return false;
    }
    if (item.itemType !== baseItem.itemType) {
      alertRelationError("relate-multilingual-item-error-different-item-type");
      return false;
    }
  }

  return true;
}

export async function relateItems(items: Zotero.Item[]) {
  const saveOption = {
    skipDateModifiedUpdate: true,
  };
  /* Compare to ZoteroPane.relateItems, we add deep relations between all items
   */
  const relatableItems = await collectRelatableItems(items);
  if (relatableItems.length < 2 || !validateRelatableItems(relatableItems)) {
    return;
  }

  const ids = relatableItems.map((item) => item.id);
  await Zotero.DB.executeTransaction(async () => {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const item1 = Zotero.Items.get(ids[i]);
        const item2 = Zotero.Items.get(ids[j]);
        addRelatedItem(item1, item2);
        addRelatedItem(item2, item1);
        await item1.save(saveOption);
        await item2.save(saveOption);
      }
    }
  });
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

// Reference to Zotero.Item.prototype.addRelatedItem
function addRelatedItem(item1: Zotero.Item, item2: Zotero.Item) {
  if (item1.libraryID !== item2.libraryID) {
    alertRelationError("relate-multilingual-item-error-different-library");
    return false;
  }
  if (item1.itemType !== item2.itemType) {
    alertRelationError("relate-multilingual-item-error-different-item-type");
    return false;
  }
  if (item1.id === item2.id) {
    alertRelationError("relate-multilingual-item-error-same-item");
    return false;
  }
  // @ts-expect-error Allowed custom relation prefixes
  return item1.addRelation(prefix, Zotero.URI.getItemURI(item2));
}

// Reference to Zotero.Item.prototype.removeRelatedItem
function removeRelatedItem(item1: Zotero.Item, item2: Zotero.Item) {
  // @ts-expect-error Allowed custom relation prefixes
  return item1.removeRelation(prefix, Zotero.URI.getItemURI(item2));
}
