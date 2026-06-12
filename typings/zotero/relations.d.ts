declare namespace Zotero {
  type RelationObjectType = "item" | "collection";

  interface RelationsAPI {
    readonly relatedItemPredicate: string;
    readonly linkedObjectPredicate: string;
    readonly replacedItemPredicate: string;

    getByPredicateAndObject(
      objectType: "item",
      predicate: string,
      object: string,
    ): Promise<Zotero.Item[]>;

    getByPredicateAndObject(
      objectType: "collection",
      predicate: string,
      object: string,
    ): Promise<Zotero.Collection[]>;

    getByPredicateAndObject(
      objectType: RelationObjectType,
      predicate: string,
      object: string,
    ): Promise<Array<Zotero.Item | Zotero.Collection>>;
  }

  const Relations: RelationsAPI;
}
