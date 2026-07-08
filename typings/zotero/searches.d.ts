declare namespace _ZoteroTypes {
  interface Searches {
    getAll(libraryID: number): Promise<Zotero.Search[]>;
  }
}
