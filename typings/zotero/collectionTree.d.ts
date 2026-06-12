/**
 * Zotero CollectionTree types used by Banyan.
 *
 * Extends the upstream _ZoteroTypes.CollectionTree with additional properties
 * and initialization options that Banyan's dialogs rely on.
 */

declare namespace _ZoteroTypes {
  interface VirtualizedTableSelection {
    focused: number;
    selected: Set<number>;
  }

  interface VirtualizedTable {
    selection: VirtualizedTableSelection;
    invalidate?: () => void;
    forceUpdate?: () => void;
    _onKeyDown?: (e: KeyboardEvent) => unknown;
  }

  interface CollectionTreeRowRef {
    libraryID: number;
    [key: string]: unknown;
  }

  interface CollectionTreeRow {
    id: string | number;
    ref: CollectionTreeRowRef;
    getItems: () => Promise<Array<Zotero.Item>>;
    setSearch?: (searchText: string, mode?: string) => void;
    isSearch?: () => boolean;
    isSearchMode?: () => boolean;
    isCollection?: () => boolean;
    isLibrary?: () => boolean;
    visibilityGroup?: string;
    view?: Record<string, unknown>;
  }

  interface TreeSelection {
    count: number;
    focused: number;
  }

  interface CollectionTreeInitOptions {
    onSelectionChange: () => void;
    dragAndDrop?: boolean;
    filterLibraryIDs?: number[];
    hideSources?: string[];
    onContextMenu?: (...args: unknown[]) => void;
  }

  interface CollectionTree {
    selection: TreeSelection;
    getRow: (index: number) => CollectionTreeRow;
  }
}

declare module "zotero/collectionTree" {
  const CollectionTree: {
    init: (
      domEl: HTMLElement | null,
      opts: _ZoteroTypes.CollectionTreeInitOptions,
    ) => Promise<_ZoteroTypes.CollectionTree>;
  };
  export = CollectionTree;
}
