declare namespace Zotero {
  interface ZoteroPane {
    collectionsView?: false | _ZoteroTypes.CollectionTree;
    selectItem?: (
      itemID: number,
      options?: { inLibraryRoot?: boolean },
    ) => Promise<boolean>;
  }
}
