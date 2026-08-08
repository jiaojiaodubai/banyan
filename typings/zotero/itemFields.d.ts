/**
 * Zotero ItemFields types used by Banyan.
 *
 * Mirrors the public surface of `chrome/content/zotero/xpcom/data/itemFields.js`
 * so the missing upstream declaration can be contributed back to zotero-types.
 */

declare namespace _ZoteroTypes {
  interface ItemFields {
    init(): Promise<void>;

    /**
     * Return the fieldID for a passed fieldID or fieldName, or false if unknown.
     */
    getID(field: number | string): number | false;

    /**
     * Return the fieldName for a passed fieldID or fieldName, or false if unknown.
     */
    getName(field: number | string): string | false;

    isValidForType(fieldID: number, itemTypeID: number): boolean;
    isInteger(fieldID: number): boolean;
    getItemTypeFields(itemTypeID: number): number[];
    isBaseField(field: number | string): boolean;
    isFieldOfBase(field: number | string, baseField: number | string): boolean;

    /**
     * Return the fieldID of the type-specific field for a given base field,
     * or false if none.
     */
    getFieldIDFromTypeAndBase(
      itemType: string,
      baseField: number | string,
    ): number | false;

    /**
     * Return the fieldID of the base field for a given type-specific field,
     * or false if none.
     */
    getBaseIDFromTypeAndField(
      itemType: string,
      typeField: number | string,
    ): number | false;

    getTypeFieldsFromBase(
      baseField: number | string,
      asNames?: boolean,
    ): number[] | string[] | false;

    getAll(): Array<{ id: number; name: string }>;
    getLocalizedString(field: number | string): string;
    isDate(field: number | string): boolean;
    isCustom(fieldID: number): boolean;
    getBaseMappedFields(): number[];
    isAutocompleteField(field: number | string): boolean;
    isMultiline(field: number | string): boolean;

    getDirection(
      itemTypeID: number,
      field: number | string,
      itemLanguage?: string,
    ): "auto" | "ltr" | "rtl";
  }
}

declare namespace Zotero {
  const ItemFields: _ZoteroTypes.ItemFields;
}
