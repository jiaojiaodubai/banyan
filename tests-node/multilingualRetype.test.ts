import { assert } from "chai";
import {
  hasWriteMarker,
  isSameGroup,
  isSyncWrite,
  selectBlockedMembers,
  selectLostFieldIDs,
  selectMismatchedMembers,
  wasItemTypeChanged,
  type GroupMember,
  type RetypeFieldSource,
} from "../src/utils/multilingualRetype";

const member = (
  id: number,
  itemTypeID: number,
  libraryID = 1,
  hasCreators = false,
  content = `content-${id}`,
  deleted = false,
): GroupMember => ({
  id,
  libraryID,
  itemTypeID,
  hasCreators,
  deleted,
  content,
});

const BOOK = 2;
const BOOK_SECTION = 22;
const BOOK_TITLE = 15;
const SHORT_TITLE = 17;

const ITEM_TYPE_IDS: Record<string, number> = {
  book: BOOK,
  bookSection: BOOK_SECTION,
};
const FIELD_IDS: Record<string, number> = {
  bookTitle: BOOK_TITLE,
  shortTitle: SHORT_TITLE,
};

/** `selectLostFieldIDs()` resolves these two host lookups. */
function stubFieldIDs(): () => void {
  const global = globalThis as unknown as { Zotero: unknown };
  const previous = global.Zotero;
  global.Zotero = {
    ItemTypes: { getID: (name: string) => ITEM_TYPE_IDS[name] ?? false },
    ItemFields: { getID: (name: string) => FIELD_IDS[name] ?? false },
  };
  return () => {
    global.Zotero = previous;
  };
}

/** Only the three members `selectLostFieldIDs()` reads. */
function fieldSource(
  itemTypeID: number,
  fields: Record<string, string> = {},
  notInType: number[] | false = [],
): RetypeFieldSource {
  return {
    itemTypeID,
    getField: (field: string) => fields[field] ?? "",
    getFieldsNotInType: () => notInType,
  };
}

describe("multilingual group retyping", function () {
  describe("wasItemTypeChanged", function () {
    it("recognizes the previous type name Item.setType() records", function () {
      assert.isTrue(
        wasItemTypeChanged({ 5: { changed: { itemType: "book" } } }, 5),
      );
      // Notifier ids arrive as numbers; the extra data is keyed by string.
      assert.isTrue(
        wasItemTypeChanged({ "5": { changed: { itemType: "book" } } }, "5"),
      );
    });

    it("ignores saves that only touched fields or relations", function () {
      assert.isFalse(wasItemTypeChanged({ 5: { changed: { title: "x" } } }, 5));
      assert.isFalse(wasItemTypeChanged({ 5: { changed: {} } }, 5));
      assert.isFalse(wasItemTypeChanged({ 5: {} }, 5));
    });

    it("ignores another item's change and malformed data", function () {
      assert.isFalse(
        wasItemTypeChanged({ 6: { changed: { itemType: "book" } } }, 5),
      );
      assert.isFalse(wasItemTypeChanged(undefined, 5));
      assert.isFalse(wasItemTypeChanged(null, 5));
      assert.isFalse(wasItemTypeChanged("book", 5));
      assert.isFalse(wasItemTypeChanged({ 5: { changed: null } }, 5));
      assert.isFalse(
        wasItemTypeChanged({ 5: { changed: { itemType: "" } } }, 5),
      );
    });
  });

  describe("isSyncWrite", function () {
    it("recognizes the marker Zotero's sync saves with", function () {
      assert.isTrue(isSyncWrite({ 5: { skipRenameFile: true } }, 5));
      // Notifier ids arrive as numbers; the extra data is keyed by string.
      assert.isTrue(isSyncWrite({ "5": { skipRenameFile: true } }, "5"));
    });

    it("ignores ordinary saves and malformed extra data", function () {
      assert.isFalse(isSyncWrite({ 5: { changed: {} } }, 5));
      assert.isFalse(isSyncWrite({ 6: { skipRenameFile: true } }, 5));
      assert.isFalse(isSyncWrite({ 5: { skipRenameFile: "true" } }, 5));
      assert.isFalse(isSyncWrite(undefined, 5));
      assert.isFalse(isSyncWrite(null, 5));
      assert.isFalse(isSyncWrite("skipRenameFile", 5));
      assert.isFalse(isSyncWrite({ 5: null }, 5));
    });
  });

  describe("hasWriteMarker", function () {
    it("reads whichever marker the write was saved with", function () {
      const extraData = { 5: { banyanMultilingualRetype: true } };
      assert.isTrue(hasWriteMarker(extraData, 5, "banyanMultilingualRetype"));
      assert.isFalse(hasWriteMarker(extraData, 5, "skipRenameFile"));
      assert.isFalse(
        hasWriteMarker({ 5: { changed: {} } }, 5, "banyanMultilingualRetype"),
      );
      assert.isFalse(hasWriteMarker(undefined, 5, "banyanMultilingualRetype"));
    });
  });

  describe("selectLostFieldIDs", function () {
    let unstub: () => void;

    beforeEach(function () {
      unstub = stubFieldIDs();
    });

    afterEach(function () {
      unstub();
    });

    it("adds the short title a book loses when becoming a bookSection", function () {
      const lost = selectLostFieldIDs(
        fieldSource(BOOK, { shortTitle: "Short" }),
        BOOK_SECTION,
      );
      assert.deepEqual(lost, [SHORT_TITLE]);
    });

    it("adds nothing extra without a short title to lose", function () {
      assert.deepEqual(selectLostFieldIDs(fieldSource(BOOK), BOOK_SECTION), []);
    });

    it("lists a short title the type switch already reports only once", function () {
      const lost = selectLostFieldIDs(
        fieldSource(BOOK, { shortTitle: "Short" }, [SHORT_TITLE]),
        BOOK_SECTION,
      );
      assert.deepEqual(lost, [SHORT_TITLE]);
    });

    it("does not report the book title handed over to `title`", function () {
      const lost = selectLostFieldIDs(
        fieldSource(BOOK_SECTION, { bookTitle: "Book" }, [BOOK_TITLE]),
        BOOK,
      );
      assert.deepEqual(lost, []);
    });

    it("still reports a book title that `title` already fills", function () {
      const lost = selectLostFieldIDs(
        fieldSource(BOOK_SECTION, { bookTitle: "Book", title: "Chapter" }, [
          BOOK_TITLE,
        ]),
        BOOK,
      );
      assert.deepEqual(lost, [BOOK_TITLE]);
    });

    it("reports the short title a bookSection loses when becoming a book", function () {
      const lost = selectLostFieldIDs(
        fieldSource(BOOK_SECTION, { bookTitle: "Book", shortTitle: "Short" }, [
          BOOK_TITLE,
        ]),
        BOOK,
      );
      assert.deepEqual(lost, [SHORT_TITLE]);
    });

    it("leaves other type switches to `getFieldsNotInType()`", function () {
      assert.deepEqual(
        selectLostFieldIDs(fieldSource(BOOK, {}, [1, 2]), 17),
        [1, 2],
      );
      // `getFieldsNotInType()` may fail outright; an empty list is the answer.
      assert.deepEqual(
        selectLostFieldIDs(fieldSource(BOOK, {}, false), 17),
        [],
      );
    });
  });

  describe("selectMismatchedMembers", function () {
    const changed = { id: 1, libraryID: 1, itemTypeID: 22 };

    it("picks the members whose type differs from the changed item", function () {
      const mismatched = selectMismatchedMembers(changed, [
        member(2, 2),
        member(3, 22),
        member(4, 7),
      ]);
      assert.deepEqual(
        mismatched.map((m) => m.id),
        [2, 4],
      );
    });

    it("never lists the changed item itself", function () {
      assert.deepEqual(selectMismatchedMembers(changed, [member(1, 2)]), []);
    });

    it("leaves members in another library alone", function () {
      assert.deepEqual(selectMismatchedMembers(changed, [member(2, 2, 9)]), []);
    });

    it("returns nothing once the whole group already agrees", function () {
      assert.deepEqual(
        selectMismatchedMembers(changed, [member(2, 22), member(3, 22)]),
        [],
      );
    });

    it("lists a member reached twice only once", function () {
      const mismatched = selectMismatchedMembers(changed, [
        member(2, 2),
        member(2, 2),
      ]);
      assert.lengthOf(mismatched, 1);
    });
  });

  describe("selectBlockedMembers", function () {
    it("blocks the members whose creators the new type cannot take", function () {
      const blocked = selectBlockedMembers(
        [member(2, 2, 1, true), member(3, 2), member(4, 2, 1, true)],
        false,
      );
      assert.deepEqual(
        blocked.map((m) => m.id),
        [2, 4],
      );
    });

    it("blocks nothing when the new type has creators", function () {
      assert.deepEqual(selectBlockedMembers([member(2, 2, 1, true)], true), []);
    });
  });

  describe("isSameGroup", function () {
    const before = (): GroupMember[] => [member(2, 2), member(3, 7, 1, true)];

    it("holds for the same members in any order", function () {
      assert.isTrue(
        isSameGroup(before(), [member(3, 7, 1, true), member(2, 2)]),
      );
    });

    it("detects a member that appeared, vanished, or was retyped", function () {
      assert.isFalse(isSameGroup(before(), [member(2, 2)]));
      assert.isFalse(
        isSameGroup(before(), [
          member(2, 2),
          member(3, 7, 1, true),
          member(4, 9),
        ]),
      );
      assert.isFalse(
        isSameGroup(before(), [member(2, 9), member(3, 7, 1, true)]),
      );
    });

    it("detects a member that moved to another library", function () {
      assert.isFalse(
        isSameGroup(before(), [member(2, 2, 9), member(3, 7, 1, true)]),
      );
    });

    it("detects a member whose fields or creators changed", function () {
      assert.isFalse(
        isSameGroup(before(), [
          member(2, 2, 1, false, "edited"),
          member(3, 7, 1, true),
        ]),
      );
    });

    it("detects a member that was trashed", function () {
      assert.isFalse(
        isSameGroup(before(), [
          member(2, 2, 1, false, "content-2", true),
          member(3, 7, 1, true),
        ]),
      );
    });

    it("holds for two empty groups", function () {
      assert.isTrue(isSameGroup([], []));
    });
  });
});
