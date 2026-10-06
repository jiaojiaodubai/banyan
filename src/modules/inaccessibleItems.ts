import type { Cite, CitationContext } from "../../typings/style";
import { useL10n } from "../utils/locale";
import { checkURIAccessibility, type InaccessibleReason } from "../utils/uri";

export type InaccessibleItemInfo = {
  cite: Cite;
  contextId: string;
  reason: InaccessibleReason;
  uri: string;
};

const t = useL10n();

/**
 * Scan all contexts for inaccessible items
 *
 * Each distinct URI is checked and reported once: the same item is commonly
 * cited several times, while the dialog counts and the import step are per
 * item.
 *
 * @param contexts - Citation contexts to scan
 * @returns Array of inaccessible item information
 */
export async function scanInaccessibleItems(
  contexts: CitationContext[],
): Promise<InaccessibleItemInfo[]> {
  const inaccessibleItems: InaccessibleItemInfo[] = [];
  const seenUris = new Set<string>();

  for (const context of contexts) {
    for (const cite of context.cites) {
      const uri = cite.item.uri;
      if (!uri || seenUris.has(uri)) {
        continue;
      }
      seenUris.add(uri);

      const accessibility = await checkURIAccessibility(uri);
      if (!accessibility.accessible && accessibility.reason) {
        inaccessibleItems.push({
          cite,
          contextId: context.id,
          reason: accessibility.reason,
          uri,
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
 * Only the reasons that were actually found are listed, and only the actions
 * that make sense for them are offered: importing is available solely when
 * there are cross-library items, because deleted and unknown-group items have
 * no metadata to import.
 *
 * @param inaccessibleItems - Array of inaccessible item information
 * @returns User's chosen action: 'import' | 'ignore' | 'cancel'
 */
export async function showInaccessibleItemsDialog(
  inaccessibleItems: InaccessibleItemInfo[],
): Promise<"import" | "ignore" | "cancel"> {
  const grouped = groupInaccessibleItemsByReason(inaccessibleItems);
  const counts = new Map<InaccessibleReason, number>([
    ["cross-library", grouped.get("cross-library")?.length || 0],
    ["deleted", grouped.get("deleted")?.length || 0],
    ["unknown-group", grouped.get("unknown-group")?.length || 0],
    ["invalid-uri", grouped.get("invalid-uri")?.length || 0],
  ]);
  const present = Array.from(counts)
    .filter(([, count]) => count > 0)
    .map(([reason]) => reason);
  const canImport = present.includes("cross-library");

  // Build message
  const lines: string[] = [t("inaccessible-items-intro")];
  for (const reason of present) {
    lines.push(
      `• ${t(`inaccessible-items-count-${reason}`, {
        args: { count: counts.get(reason) ?? 0 },
      })}`,
    );
  }

  lines.push("", t("inaccessible-items-reason-heading"));
  if (present.includes("cross-library")) {
    lines.push(`• ${t("inaccessible-items-reason-shared")}`);
  }
  if (present.includes("deleted")) {
    lines.push(`• ${t("inaccessible-items-reason-deleted")}`);
  }
  if (present.includes("unknown-group")) {
    lines.push(`• ${t("inaccessible-items-reason-group-access")}`);
  }
  if (present.includes("invalid-uri")) {
    lines.push(`• ${t("inaccessible-items-desc-invalid-uri")}`);
  }

  lines.push("", t("inaccessible-items-solution-heading"));
  if (canImport) {
    lines.push(
      `• ${t("inaccessible-items-solution-group")}`,
      `  (${t("inaccessible-items-solution-group-link")})`,
      `• ${t("inaccessible-items-solution-import")}`,
    );
  }
  if (present.includes("deleted")) {
    lines.push(`• ${t("inaccessible-items-solution-deleted")}`);
  }
  if (present.includes("unknown-group")) {
    lines.push(`• ${t("inaccessible-items-solution-unknown-group")}`);
  }
  lines.push(`• ${t("inaccessible-items-solution-ignore")}`);

  const actions: Array<{
    action: "import" | "ignore" | "cancel";
    label: string;
  }> = [];
  if (canImport) {
    actions.push({
      action: "import",
      label: t("inaccessible-items-button-import"),
    });
  }
  actions.push({
    action: "ignore",
    label: t("inaccessible-items-button-ignore"),
  });
  actions.push({
    action: "cancel",
    label: t("inaccessible-items-button-cancel"),
  });

  lines.push("", t("inaccessible-items-action-heading"));
  for (const { label } of actions) {
    lines.push(`- ${label}`);
  }

  const message = lines.join("\n");

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

  const [button0, button1, button2] = actions;
  const result = Zotero.Prompt.confirm({
    window: parentWindow,
    title: t("inaccessible-items-title"),
    text: message,
    button0: button0.label,
    button1: button1?.label,
    button2: button2?.label,
  });

  return actions[result]?.action ?? "cancel";
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
