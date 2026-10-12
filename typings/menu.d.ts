/**
 * Contract between the library-item menu aggregator (`src/modules/menu.ts`) and
 * the feature modules that contribute entries to it.
 */

/** Context Zotero passes to the hooks of a `main/library/item` menu entry. */
export type ItemMenuContext = _ZoteroTypes.MenuManager.LibraryMenuContext;

/** One entry of the "Banyan" library-item submenu (item or submenu). */
export type ItemMenuData = _ZoteroTypes.MenuManager.MenuData<ItemMenuContext>;

/**
 * A feature's contribution to the "Banyan" submenu. `build()` runs on every
 * (re)registration, so it may read live state, and decides the structure there:
 * Zotero freezes the entries at registration time and only calls their
 * `onShowing` hooks each time the popup opens.
 */
export interface ItemMenuContribution {
  /** Stable name, reported when `build()` throws. */
  id: string;
  /** Entries to append, in this order; `null` when nothing applies at all. */
  build(): ItemMenuData[] | null;
}
