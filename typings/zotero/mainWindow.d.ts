declare namespace Zotero {
  interface ZoteroPane {
    collectionsView?: false | _ZoteroTypes.CollectionTree;
    selectItem?: (
      itemID: number,
      options?: { inLibraryRoot?: boolean },
    ) => Promise<boolean>;
    getSelectedItems(
      asIDs?: false,
      options?: { libraryTabOnly?: boolean },
    ): Zotero.Item[];
    getSelectedItems(
      asIDs: true,
      options?: { libraryTabOnly?: boolean },
    ): number[];
  }
}

declare namespace _ZoteroTypes {
  interface ZoteroPane {
    getSelectedItems(
      asIDs?: false,
      options?: { libraryTabOnly?: boolean },
    ): Zotero.Item[];
    getSelectedItems(
      asIDs: true,
      options?: { libraryTabOnly?: boolean },
    ): number[];
  }
}
