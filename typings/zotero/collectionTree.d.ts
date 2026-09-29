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
    /**
     * Preset id used by the `id` getter for rows whose `type` is not one of
     * Zotero's built-ins (Banyan's cited-items rows set this).
     */
    _id?: string;
    level?: number;
    isOpen?: boolean;
    ref: CollectionTreeRowRef;
    getItems: (options?: {
      unfiltered?: boolean;
    }) => Promise<Array<Zotero.Item>>;
    setSearch?: (searchText: string, mode?: string) => void;
    clearCache?: () => void;
    isSearch?: () => boolean;
    isSearchMode?: () => boolean;
    isCollection?: () => boolean;
    isLibrary?: (includeGlobal?: boolean) => boolean;
    visibilityGroup?: string;
    view?: Record<string, unknown>;
  }

  interface TreeSelection {
    count: number;
    focused: number;
    selected?: Set<number>;
    select: (index: number, shouldDebounce?: boolean) => boolean;
    /**
     * While true, the tree applies no selection change and fires no
     * `onSelectionChange`/`select` event, so only the code that set it may clear
     * it.
     */
    selectEventsSuppressed: boolean;
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
    /**
     * Name of the row's icon, resolved by `_getIcon()`. Defaults to the row's
     * type, so an unknown type gets no icon unless this is overridden.
     */
    getIconName: (index: number) => string | null;
    selectByID?: (id: string, ensureRowVisible?: boolean) => Promise<boolean>;
    selectLibrary: (libraryID?: number) => Promise<void>;
    /** Resolves once the `select` event next fires. */
    waitForSelect: () => Promise<void>;
    reload: () => Promise<void>;
    /**
     * Expands the row at `row`, splicing its children into `rows`.
     *
     * @returns The number of rows added, or `false` for the row types that are
     *     never expanded (publications and feed rows).
     */
    _expandRow: (
      rows: CollectionTreeRow[],
      row: number,
      forceOpen?: boolean,
    ) => Promise<number | false>;
    unregister: () => void;
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
    new (
      collectionTreeView: _ZoteroTypes.CollectionTree,
      type: string,
      ref: unknown,
      level?: number,
      isOpen?: boolean,
    ): _ZoteroTypes.CollectionTreeRow;
  };
}
