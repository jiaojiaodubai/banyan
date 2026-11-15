/**
 * Which item fields can carry field-local rich-text markup.
 *
 * The decision follows two sources, in this order:
 * 1. Zotero's item-field data model (`isDate`, `isInteger`, creator/record
 *    fields), and the Zotero item-types-and-fields documentation for fields
 *    whose value can legitimately be prose (e.g. Edition and Volume).
 * 2. CSL/CSL-M variable families: date and name variables are not text;
 *    identifiers and parser switches must stay byte-exact. CSL number
 *    variables are not automatically excluded: the CSL specification renders
 *    non-numeric number-variable content as text (e.g. `Edition: 2nd ed.` or
 *    `Volume: 2: Organizational Psychology`), so those fields can be edited.
 *
 * This remains a denylist: new Zotero text fields default to allowed. Audit the
 * list when Zotero adds fields whose value is used as a number or identifier.
 */

/** Fields that are records, identifiers, or style/logic switches. */
const NON_RICH_TEXT_FIELDS: ReadonlySet<string> = new Set([
  // Record metadata / item identity. `version` here is the item record
  // version from `toBanyanItem`, not Zotero's `versionNumber` field (the CSL
  // `version` string variable), which is intentionally editable.
  "version",
  "abstractNote",
  "collections",
  "dateAdded",
  "dateModified",
  "accessDate",
  "notes",
  "key",
  "uri",
  "relations",
  "itemType",
  "itemTypeID",
  "libraryID",
  "id",
  "synced",
  "createdByUserID",
  "lastModifiedByUserID",
  "tags",
  "creators",
  "parentItem",
  "deleted",
  // Identifiers / language. These are matched, normalized or used as lookup
  // keys; formatting tags would change the value the style sees.
  "DOI",
  "ISBN",
  "ISSN",
  "PMID",
  "PMCID",
  "url",
  "callNumber",
  "libraryCatalog",
  "citationKey",
  "language",
  // Numeric/locator fields whose Zotero documentation defines them as
  // numbers or lookup values. `edition` and `volume` are deliberately absent:
  // Zotero permits prose there ("2: Organizational Psychology"), and CSL
  // renders non-numeric number-variable content as text.
  "issue",
  "number",
  "seriesNumber",
  "partNumber",
  "section",
  "pages",
  "numPages",
  "numberOfVolumes",
  "reportNumber",
  "billNumber",
  "code",
  "codeNumber",
  "session",
  "legislativeBody",
  "court",
  "reporter",
  "reporterVolume",
  "firstPage",
  "lastPage",
  "publicLawNumber",
  "docketNumber",
  "history",
  // `extra` is edited as parsed pairs, never as a single rich-text value.
  "extra",
]);

const NORMALIZED_BLACKLIST = new Set(
  [...NON_RICH_TEXT_FIELDS].map((name) => name.toLowerCase()),
);

function isBlacklisted(fieldName: string, baseName?: string): boolean {
  return (
    NORMALIZED_BLACKLIST.has(fieldName.toLowerCase()) ||
    (!!baseName && NORMALIZED_BLACKLIST.has(baseName.toLowerCase()))
  );
}

/** Whether one field of this item can carry field-local markup. */
export function isRichTextField(item: Zotero.Item, fieldName: string): boolean {
  const fieldID = Zotero.ItemFields.getID(fieldName);
  if (!fieldID) return false;

  const typeFieldID =
    Zotero.ItemFields.getFieldIDFromTypeAndBase(item.itemTypeID, fieldID) ||
    fieldID;
  if (!Zotero.ItemFields.isValidForType(typeFieldID, item.itemTypeID)) {
    return false;
  }
  if (Zotero.Items.isPrimaryField(fieldName)) return false;
  if (Zotero.ItemFields.isDate(typeFieldID)) return false;
  if (Zotero.ItemFields.isInteger(typeFieldID)) return false;

  const baseID = Zotero.ItemFields.getBaseIDFromTypeAndField(
    item.itemTypeID,
    typeFieldID,
  );
  const baseName = baseID ? Zotero.ItemFields.getName(baseID) || "" : "";
  if (isBlacklisted(fieldName, baseName)) return false;
  return true;
}
