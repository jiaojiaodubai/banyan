import type { Cite, CitationContext } from "../../typings/style";
import { checkURIAccessibility, type InaccessibleReason } from "../utils/uri";

export type InaccessibleItemInfo = {
  cite: Cite;
  contextId: string;
  reason: InaccessibleReason;
  uri: string;
};

/**
 * Scan all contexts for inaccessible items
 *
 * @param contexts - Citation contexts to scan
 * @returns Array of inaccessible item information
 */
export async function scanInaccessibleItems(
  contexts: CitationContext[],
): Promise<InaccessibleItemInfo[]> {
  const inaccessibleItems: InaccessibleItemInfo[] = [];

  for (const context of contexts) {
    for (const cite of context.cites) {
      if (!cite.item.uri) {
        continue;
      }

      const accessibility = await checkURIAccessibility(cite.item.uri);
      if (!accessibility.accessible && accessibility.reason) {
        inaccessibleItems.push({
          cite,
          contextId: context.id,
          reason: accessibility.reason,
          uri: cite.item.uri,
        });
      }
    }
  }

  return inaccessibleItems;
}

/**
 * Group inaccessible items by reason
 */
export function groupInaccessibleItemsByReason(
  items: InaccessibleItemInfo[],
): Map<InaccessibleReason, InaccessibleItemInfo[]> {
  const grouped = new Map<InaccessibleReason, InaccessibleItemInfo[]>();

  for (const item of items) {
    const existing = grouped.get(item.reason) || [];
    existing.push(item);
    grouped.set(item.reason, existing);
  }

  return grouped;
}

/**
 * Show dialog to inform user about inaccessible items and provide solutions
 *
 * @param inaccessibleItems - Array of inaccessible item information
 * @returns User's chosen action: 'import' | 'ignore' | 'cancel'
 */
export async function showInaccessibleItemsDialog(
  inaccessibleItems: InaccessibleItemInfo[],
): Promise<"import" | "ignore" | "cancel"> {
  const grouped = groupInaccessibleItemsByReason(inaccessibleItems);
  const crossLibraryCount = grouped.get("cross-library")?.length || 0;
  const deletedCount = grouped.get("deleted")?.length || 0;
  const unknownGroupCount = grouped.get("unknown-group")?.length || 0;

  // Build message
  let message = "Some items in this document are not accessible:\n\n";

  if (crossLibraryCount > 0) {
    message += `• ${crossLibraryCount} item(s) from another user's personal library\n`;
  }
  if (deletedCount > 0) {
    message += `• ${deletedCount} item(s) have been deleted\n`;
  }
  if (unknownGroupCount > 0) {
    message += `• ${unknownGroupCount} item(s) from inaccessible group libraries\n`;
  }

  message += "\n";
  message +=
    "This typically happens when:\n" +
    "1. A document was created using personal library items and shared with others\n" +
    "2. Items were deleted after being cited\n" +
    "3. Group library access was revoked\n\n";

  message +=
    "Recommended solutions:\n" +
    "• For collaboration: Create a shared Group library and use items from there\n" +
    "  (See: https://www.zotero.org/support/groups)\n" +
    "• For personal use: Import these items to your library (click 'Import Items')\n" +
    "• Ignore: Continue without syncing these items (not recommended)\n\n";

  message +=
    "What would you like to do?\n" +
    "- Import Items: Import inaccessible items to your library\n" +
    "- Ignore: Continue without syncing (items will use cached data)\n" +
    "- Cancel: Stop the refresh operation";

  // Activate the Zotero main window so the modal becomes visible to the user.
  // Without this, the dialog can be hidden behind other applications (e.g. WPS),
  // causing the originating HTTP request to hang indefinitely waiting for user input.
  let parentWindow: Window | null = null;
  try {
    parentWindow = Zotero.getMainWindow() ?? null;
    if (parentWindow) {
      // @ts-expect-error activate is not typed
      Zotero.Utilities.Internal.activate(parentWindow);
    }
  } catch (e) {
    ztoolkit.logError(e);
  }
  const result = Zotero.Prompt.confirm({
    // @ts-expect-error parentWindow is a Window from Zotero.getMainWindow() but Prompt expects mozIDOMWindowProxy
    window: parentWindow ?? undefined,
    title: "Inaccessible Items Detected",
    text: message,
    button0: "Import Items",
    button1: "Ignore",
    button2: "Cancel",
  });

  if (result === 0) {
    return "import";
  }
  if (result === 1) {
    return "ignore";
  }
  return "cancel";
}

/**
 * Import inaccessible items to the current user's library
 *
 * This creates new items in the user's library based on the cached item data
 * from the citation context. The new items will have different URIs but the
 * same metadata.
 *
 * @param inaccessibleItems - Array of inaccessible item information
 * @returns Map of old URI to new item
 */
export async function importInaccessibleItems(
  inaccessibleItems: InaccessibleItemInfo[],
): Promise<Map<string, Zotero.Item>> {
  const imported = new Map<string, Zotero.Item>();

  // Only import cross-library items (not deleted or unknown-group)
  const itemsToImport = inaccessibleItems.filter(
    (info) => info.reason === "cross-library",
  );

  if (itemsToImport.length === 0) {
    return imported;
  }

  await Zotero.DB.executeTransaction(async () => {
    for (const info of itemsToImport) {
      try {
        // Create new item in user's library
        const newItem = new Zotero.Item(info.cite.item.itemType);

        // Copy metadata from cached item
        const cachedItem = info.cite.item;

        // Set basic fields
        if (cachedItem.title) {
          newItem.setField("title", cachedItem.title);
        }
        if (cachedItem.date) {
          newItem.setField("date", cachedItem.date);
        }

        // Copy all other fields
        for (const [field, value] of Object.entries(cachedItem)) {
          if (
            typeof value === "string" &&
            field !== "id" &&
            field !== "key" &&
            field !== "uri" &&
            field !== "itemType" &&
            field !== "title" &&
            field !== "date"
          ) {
            try {
              newItem.setField(field, value);
            } catch {
              // Skip invalid fields
            }
          }
        }

        // Copy creators
        if (Array.isArray(cachedItem.creators)) {
          for (let i = 0; i < cachedItem.creators.length; i++) {
            newItem.setCreator(
              i,
              // TODO: Remove this assertion after zotero-types syncs newer
              // Zotero creator types such as "originalCreator".
              cachedItem.creators[i] as Parameters<
                Zotero.Item["setCreator"]
              >[1],
            );
          }
        }

        // Copy tags
        if (Array.isArray(cachedItem.tags)) {
          for (const tag of cachedItem.tags) {
            newItem.addTag(tag);
          }
        }

        await newItem.save();
        imported.set(info.uri, newItem);
      } catch (e) {
        ztoolkit.logError(e);
      }
    }
  });

  return imported;
}
