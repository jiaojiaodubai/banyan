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
    type?: string;
    ref: CollectionTreeRowRef;
    getItems: (options?: {
      unfiltered?: boolean;
    }) => Promise<Array<Zotero.Item>>;
    setSearch?: (searchText: string, mode?: string) => void;
    clearCache?: () => void;
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
    selected?: Set<number>;
  }

  interface CollectionTreeInitOptions {
    onSelectionChange: () => void | Promise<void>;
    initialFolder?: string;
    dragAndDrop?: boolean;
    filterLibraryIDs?: number[];
    hideSources?: string[];
    multiSelect?: boolean;
    onContextMenu?: (...args: unknown[]) => void;
  }

  interface CollectionTreeLoadEvent {
    addListener: (listener: () => void, once?: boolean) => void;
    removeListener: (listener: () => void) => void;
  }

  interface CollectionTree {
    selection: TreeSelection;
    selectedTreeRow?: CollectionTreeRow;
    itemTreeView: CollectionViewItemTree | null;
    onLoad: CollectionTreeLoadEvent;
    getRow: (index: number) => CollectionTreeRow;
    selectByID?: (id: string, ensureRowVisible?: boolean) => Promise<boolean>;
    selectLibrary: (libraryID?: number) => Promise<void>;
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

declare namespace Zotero {
  const CollectionTreeRow: {
    prototype: _ZoteroTypes.CollectionTreeRow;
  };
}
