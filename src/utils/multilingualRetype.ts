export type GroupMember = {
  id: number;
  libraryID: number;
  itemTypeID: number;
  hasCreators: boolean;
  deleted: boolean;
  /** Serialized content, compared against what the prompt listed. */
  content: string;
};

/** The field access `selectLostFieldIDs()` needs; satisfied by `Zotero.Item`. */
export type RetypeFieldSource = {
  itemTypeID: number;
  getField(field: string): string;
  getFieldsNotInType(
    newTypeID: number,
    includeEmpty?: boolean,
  ): number[] | false;
};

/** Per-id `extraData` of an item notifier event, or null when absent. */
function itemEventData(
  extraData: unknown,
  id: number | string,
): Record<string, unknown> | null {
  if (typeof extraData !== "object" || extraData === null) {
    return null;
  }
  const entry = (extraData as Record<string, unknown>)[String(id)];
  return typeof entry === "object" && entry !== null
    ? (entry as Record<string, unknown>)
    : null;
}

/**
 * Item-type change in a `modify` event (`extraData[id].changed.itemType`).
 */
export function wasItemTypeChanged(
  extraData: unknown,
  id: number | string,
): boolean {
  const changed = itemEventData(extraData, id)?.changed;
  if (typeof changed !== "object" || changed === null) {
    return false;
  }
  const previous = (changed as { itemType?: unknown }).itemType;
  return typeof previous === "string" && previous !== "";
}

/**
 * Whether a `modify` event carries `marker`, as `save({ notifierData })` and
 * Zotero's own internal writes report it: only the ids that were actually
 * written carry it, so a long background sync no longer hides edits the user
 * made meanwhile.
 */
export function hasWriteMarker(
  extraData: unknown,
  id: number | string,
  marker: string,
): boolean {
  return itemEventData(extraData, id)?.[marker] === true;
}

/**
 * Whether a `modify` event came from a sync write: `Zotero.Sync.Data.Local`
 * saves with `skipRenameFile` (`syncLocal.js`), and Zotero's own observers
 * filter on the same marker (`renameFiles.mjs`).
 */
export function isSyncWrite(extraData: unknown, id: number | string): boolean {
  return hasWriteMarker(extraData, id, "skipRenameFile");
}

/**
 * Field IDs `setType()` clears, as the item pane's type menu lists them.
 * `getFieldsNotInType()` misses the book ↔ bookSection cases that
 * `Zotero.Item.setType()` applies on top (`item.js`, mirrored by
 * `itemBox.changeTypeTo()`): a book's title moves to `bookTitle` and its short
 * title is cleared, and a bookSection's book title is moved to `title` — only
 * then is `shortTitle` cleared instead of lost.
 */
export function selectLostFieldIDs(
  source: RetypeFieldSource,
  newTypeID: number,
): number[] {
  const lost = source.getFieldsNotInType(newTypeID, true);
  const lostFieldIDs = Array.isArray(lost) ? [...lost] : [];
  const bookTypeID = Zotero.ItemTypes.getID("book");
  const bookSectionTypeID = Zotero.ItemTypes.getID("bookSection");
  const shortTitleFieldID = Zotero.ItemFields.getID("shortTitle");

  if (source.itemTypeID === bookTypeID && newTypeID === bookSectionTypeID) {
    if (source.getField("shortTitle")) {
      addFieldID(lostFieldIDs, shortTitleFieldID);
    }
  } else if (
    source.itemTypeID === bookSectionTypeID &&
    newTypeID === bookTypeID
  ) {
    if (source.getField("bookTitle") && !source.getField("title")) {
      // The book title is transferred to `title`, so it is not lost.
      removeFieldID(lostFieldIDs, Zotero.ItemFields.getID("bookTitle"));
      if (source.getField("shortTitle")) {
        addFieldID(lostFieldIDs, shortTitleFieldID);
      }
    }
  }
  return lostFieldIDs;
}

function addFieldID(fieldIDs: number[], fieldID: number | false): void {
  if (typeof fieldID === "number" && !fieldIDs.includes(fieldID)) {
    fieldIDs.push(fieldID);
  }
}

function removeFieldID(fieldIDs: number[], fieldID: number | false): void {
  if (typeof fieldID !== "number") {
    return;
  }
  const index = fieldIDs.indexOf(fieldID);
  if (index !== -1) {
    fieldIDs.splice(index, 1);
  }
}

/** Members not on `changed`'s type (links never cross libraries). */
export function selectMismatchedMembers(
  changed: Pick<GroupMember, "id" | "libraryID" | "itemTypeID">,
  members: readonly GroupMember[],
): GroupMember[] {
  const seen = new Set<number>();
  const mismatched: GroupMember[] = [];
  for (const member of members) {
    if (
      member.id === changed.id ||
      seen.has(member.id) ||
      member.libraryID !== changed.libraryID ||
      member.itemTypeID === changed.itemTypeID
    ) {
      continue;
    }
    seen.add(member.id);
    mismatched.push(member);
  }
  return mismatched;
}

/** Members `setType()` refuses: the new type has no creators. */
export function selectBlockedMembers(
  members: readonly GroupMember[],
  newTypeHasCreators: boolean,
): GroupMember[] {
  return newTypeHasCreators
    ? []
    : members.filter((member) => member.hasCreators);
}

/**
 * Whether the group still matches what the prompt listed: same members, types,
 * deleted flags and content, so `setType()` cannot clear fields added later.
 */
export function isSameGroup(
  before: readonly GroupMember[],
  after: readonly GroupMember[],
): boolean {
  if (before.length !== after.length) {
    return false;
  }
  const afterByID = new Map(after.map((member) => [member.id, member]));
  return before.every((member) => {
    const now = afterByID.get(member.id);
    return (
      now !== undefined &&
      now.libraryID === member.libraryID &&
      now.itemTypeID === member.itemTypeID &&
      now.deleted === member.deleted &&
      now.content === member.content
    );
  });
}
