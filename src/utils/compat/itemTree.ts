type ItemTreeModule = {
  init: (
    container: Element | null,
    options: Record<string, unknown>,
  ) => Promise<_ZoteroTypes.CollectionViewItemTree>;
};

/**
 * Load Zotero item-tree module across stable/beta API changes.
 *
 * Upstream context:
 * - 5ca1fbb16 (Item tree refactor megacommit): integration code moved from
 *   requiring `zotero/itemTree` to `zotero/collectionViewItemTree`.
 *
 * Removal note:
 * - Drop the fallback branch after minimum supported Zotero version includes
 *   `zotero/collectionViewItemTree` in stable releases.
 */
export function loadCollectionViewItemTreeCompat(
  loader: typeof window.require,
): ItemTreeModule {
  try {
    return loader("zotero/collectionViewItemTree") as ItemTreeModule;
  } catch {
    return loader("zotero/itemTree") as ItemTreeModule;
  }
}
