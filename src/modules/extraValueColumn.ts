import { useL10n } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { getExtraValueForDisplay } from "@banyan/core/items/extraField";

type ZoteroPaneLike = {
  itemsView?: {
    tree?: unknown;
    refreshAndMaintainSelection?: () => Promise<void> | void;
  };
};

const t = useL10n(["mainWindow.ftl"]);

/**
 * Key returned by `Zotero.ItemTreeManager.registerColumn` for the current
 * registration. Like the menu manager, Zotero keys columns by `dataKey` and
 * `unregisterColumn()` needs the value the registration returned.
 */
let registeredColumnKey: string | false | null = null;

/** Key the "Extra value" column reads; edited in the preferences. */
export const EXTRA_VALUE_COLUMN_KEY_PREF = "extraValueColumnKey" as const;

/** Key the column reads, as the user typed it ("" leaves the column out). */
export function getConfiguredExtraKey(): string {
  return String(getPref(EXTRA_VALUE_COLUMN_KEY_PREF) ?? "").trim();
}

/**
 * Column label: the localized name alone until a key is configured, then the
 * key is spelled out so the column picker shows what the column will display.
 */
function getColumnLabel(): string {
  const base = t("item-tree-extra-value-column");
  const key = getConfiguredExtraKey();
  return key ? `${base}: ${key}` : base;
}

/**
 * (Re)register the "Extra value" column, dropping the previous registration
 * first because Zotero rejects a duplicate `dataKey`. Without a configured key
 * the column is not registered at all, so the column picker does not offer an
 * entry that could only ever be empty.
 */
export function refreshExtraValueColumn(): void {
  if (registeredColumnKey) {
    Zotero.ItemTreeManager.unregisterColumn(registeredColumnKey);
    registeredColumnKey = null;
  }

  if (getConfiguredExtraKey()) {
    registeredColumnKey = Zotero.ItemTreeManager.registerColumn({
      dataKey: "extraValue",
      label: getColumnLabel(),
      pluginID: addon.data.config.addonID,
      enabledTreeIDs: ["main"],
      width: "140",
      minWidth: 80,
      zoteroPersist: ["width", "hidden", "sortDirection"],
      dataProvider: (item) =>
        getExtraValueForDisplay(
          String(item.getField("extra") || ""),
          getConfiguredExtraKey(),
        ),
    });
  }

  void refreshOpenItemTrees();
}

export function registerExtraValueColumn(): void {
  refreshExtraValueColumn();
}

/**
 * Redraw the open item trees: registering notifies Zotero about the column
 * list, but already rendered cells keep their old text until the tree refreshes.
 */
async function refreshOpenItemTrees(): Promise<void> {
  for (const win of Zotero.getMainWindows()) {
    const pane = (win as Window & { ZoteroPane?: ZoteroPaneLike })?.ZoteroPane;
    // The main window creates ItemTree asynchronously; refreshing before that
    // leaves Zotero's ItemTree with an undefined virtualized table.
    if (pane?.itemsView && "tree" in pane.itemsView && !pane.itemsView.tree) {
      continue;
    }
    await pane?.itemsView?.refreshAndMaintainSelection?.();
  }
}
