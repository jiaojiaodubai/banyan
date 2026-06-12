/**
 * Zotero ItemTree types used by Banyan.
 *
 * Extends the upstream _ZoteroTypes.ItemTree with additional properties
 * and initialization options that Banyan's dialogs rely on.
 */

declare namespace _ZoteroTypes {
  interface ItemTreeRow {
    id?: string;
    ref: Zotero.Item;
    isOpen?: boolean;
    [key: string]: unknown;
  }

  interface ItemTreeColumnOptions {
    dataKey: string;
    hidden?: boolean;
    [key: string]: unknown;
  }

  interface ItemTreeInitOptions {
    id: string;
    dragAndDrop?: boolean;
    persistColumns?: boolean;
    columnPicker?: boolean;
    regularOnly?: boolean;
    multiSelect?: boolean;
    shouldListenForNotifications?: boolean;
    columns?: ItemTreeColumnOptions[];
    onSelectionChange?: (...args: unknown[]) => void;
    onContextMenu?: (...args: unknown[]) => void;
    onActivate?: (...args: unknown[]) => void;
    emptyMessage?: string;
    getExtraField?: (...args: unknown[]) => void;
  }

  interface ItemTree {
    collectionTreeRow?: CollectionTreeRow;
    tree?: VirtualizedTable;
    rowCount?: number;
    getRow: (index: number) => ItemTreeRow;
    getSelectedItems: {
      (): Zotero.Item[];
      (asIDs: true): number[];
      (asIDs: boolean): Zotero.Item[] | number[];
    };
    changeCollectionTreeRow: (
      collectionTreeRow: CollectionTreeRow,
    ) => Promise<void>;
    setFilter: (type: string, data?: unknown) => Promise<void>;
    setHighlightedRows?: (ids: number[]) => Promise<void>;
  }
}

declare module "zotero/itemTree" {
  const ItemTree: {
    init: (
      domEl: HTMLElement | null,
      opts: _ZoteroTypes.ItemTreeInitOptions,
    ) => Promise<_ZoteroTypes.ItemTree>;
  };
  export = ItemTree;
}

declare module "zotero/itemTreeColumns" {
  export const COLUMNS: _ZoteroTypes.ItemTreeColumnOptions[];
}
