import { assert } from "chai";
import type { InaccessibleReason, URIAccessibility } from "../src/utils/uri";

type StubItem = { id: number; deleted: boolean };

type StubState = {
  /** Item key -> item in the local user library. */
  userItems: Map<string, StubItem>;
  /** Group ID -> (item key -> item). */
  groupItems: Map<number, Map<string, StubItem>>;
  /** Replaced URI -> surviving items, i.e. `dc:replaces` relation objects. */
  replacements: Map<string, StubItem[]>;
  /** Account user ID, or null while the account has never been synced. */
  currentUserID: number | null;
  localUserKey: string;
};

const LOCAL_USER_KEY = "LocalKey1";
const USER_ID = 7264;

const userURI = (key: string) =>
  `http://zotero.org/users/${USER_ID}/items/${key}`;
const localURI = (key: string) =>
  `http://zotero.org/users/local/${LOCAL_USER_KEY}/items/${key}`;
const otherLocalURI = (key: string) =>
  `http://zotero.org/users/local/OtherKey/items/${key}`;
const foreignUserURI = (key: string) =>
  `http://zotero.org/users/999/items/${key}`;
const groupURI = (groupID: number, key: string) =>
  `http://zotero.org/groups/${groupID}/items/${key}`;

function createStubState(overrides: Partial<StubState> = {}): StubState {
  return {
    userItems: new Map(),
    groupItems: new Map(),
    replacements: new Map(),
    currentUserID: USER_ID,
    localUserKey: LOCAL_USER_KEY,
    ...overrides,
  };
}

const URI_PATTERN =
  /^http:\/\/zotero\.org\/(users|groups)\/(local\/)?(\w+)(?:\/(?:publications|feeds\/\w+))?\/items\/(\w+)$/;

/**
 * Minimal stand-in for the Zotero APIs `checkURIAccessibility` touches. The
 * item lookup mirrors `Zotero.URI._getURIObjectLibrary`, which resolves any
 * `users/...` URI to the local user library regardless of the user ID it
 * contains.
 */
function installZoteroStub(state: StubState): void {
  const lookupUserItem = (key: string) => state.userItems.get(key) ?? false;

  const stub = {
    URI: {
      getCurrentUserURI: () =>
        state.currentUserID
          ? `http://zotero.org/users/${state.currentUserID}`
          : `http://zotero.org/users/local/${state.localUserKey}`,
      getLocalUserURI: () =>
        `http://zotero.org/users/local/${state.localUserKey}`,
      getURIItem: async (uri: string) => {
        const parsed = URI_PATTERN.exec(uri);
        if (!parsed) {
          throw new Error(`Could not parse object URI ${uri}`);
        }
        const [, libraryType, , libraryId, itemKey] = parsed;
        if (libraryType === "groups") {
          const groupItems = state.groupItems.get(Number(libraryId));
          return groupItems ? (groupItems.get(itemKey) ?? false) : false;
        }
        return lookupUserItem(itemKey);
      },
    },
    Relations: {
      replacedItemPredicate: "dc:replaces",
      getByPredicateAndObject: (
        _objectType: string,
        _predicate: string,
        object: string,
      ) => Promise.resolve(state.replacements.get(object) ?? []),
    },
    Users: {
      getCurrentUserID: () => state.currentUserID,
      getLocalUserKey: () => state.localUserKey,
    },
    Groups: {
      get: (groupID: number) => (state.groupItems.has(groupID) ? {} : false),
    },
  };

  (globalThis as Record<string, unknown>).Zotero = stub;
}

function assertAccessible(result: URIAccessibility): void {
  assert.isTrue(
    result.accessible,
    `expected accessible, got ${JSON.stringify(result)}`,
  );
}

function assertInaccessible(
  result: URIAccessibility,
  reason: InaccessibleReason,
): void {
  assert.isFalse(
    result.accessible,
    `expected ${reason}, got ${JSON.stringify(result)}`,
  );
  assert.equal(result.reason, reason);
}

describe("checkURIAccessibility", function () {
  let checkURIAccessibility: (uri: string) => Promise<URIAccessibility>;

  before(async function () {
    installZoteroStub(createStubState());
    ({ checkURIAccessibility } = await import("../src/utils/uri"));
  });

  after(function () {
    delete (globalThis as Record<string, unknown>).Zotero;
  });

  async function check(uri: string, state: StubState) {
    installZoteroStub(state);
    return checkURIAccessibility(uri);
  }

  it("accepts an item that is still in the library", async function () {
    const state = createStubState({
      userItems: new Map([["ITEM0001", { id: 1, deleted: false }]]),
    });

    assertAccessible(await check(userURI("ITEM0001"), state));
  });

  it("accepts a trashed duplicate that was merged into another item", async function () {
    const state = createStubState({
      userItems: new Map([["ITEM0001", { id: 1, deleted: true }]]),
      replacements: new Map([
        [userURI("ITEM0001"), [{ id: 2, deleted: false }]],
      ]),
    });

    assertAccessible(await check(userURI("ITEM0001"), state));
  });

  it("accepts a merged duplicate that was erased from the trash", async function () {
    const state = createStubState({
      replacements: new Map([
        [userURI("ITEM0001"), [{ id: 2, deleted: false }]],
      ]),
    });

    assertAccessible(await check(userURI("ITEM0001"), state));
  });

  it("reports a trashed item as deleted when nothing replaced it", async function () {
    const state = createStubState({
      userItems: new Map([["ITEM0001", { id: 1, deleted: true }]]),
    });

    assertInaccessible(await check(userURI("ITEM0001"), state), "deleted");
  });

  it("reports a merged duplicate as deleted when the survivor is trashed too", async function () {
    const state = createStubState({
      userItems: new Map([["ITEM0001", { id: 1, deleted: true }]]),
      replacements: new Map([
        [userURI("ITEM0001"), [{ id: 2, deleted: true }]],
      ]),
    });

    assertInaccessible(await check(userURI("ITEM0001"), state), "deleted");
  });

  it("resolves a local user URI whose merge relation was migrated on login", async function () {
    // Document written before the account was synced; Zotero rewrites the
    // relation object to the account URI on login.
    const state = createStubState({
      replacements: new Map([
        [userURI("ITEM0001"), [{ id: 2, deleted: false }]],
      ]),
    });

    assertAccessible(await check(localURI("ITEM0001"), state));
  });

  it("resolves a synced URI whose merge relation still uses the local user key", async function () {
    const state = createStubState({
      replacements: new Map([
        [localURI("ITEM0001"), [{ id: 2, deleted: false }]],
      ]),
    });

    assertAccessible(await check(userURI("ITEM0001"), state));
  });

  it("does not treat the current user's own local URI as cross-library", async function () {
    const state = createStubState({ currentUserID: USER_ID });

    assertInaccessible(await check(localURI("MISSING01"), state), "deleted");
  });

  it("treats the current user's local URI as own library before syncing", async function () {
    const state = createStubState({ currentUserID: null });

    assertInaccessible(await check(localURI("MISSING01"), state), "deleted");
  });

  it("still reports another install's local URI as cross-library", async function () {
    const state = createStubState();

    assertInaccessible(
      await check(otherLocalURI("MISSING01"), state),
      "cross-library",
    );
  });

  it("still reports another user's URI as cross-library", async function () {
    const state = createStubState();

    assertInaccessible(
      await check(foreignUserURI("MISSING01"), state),
      "cross-library",
    );
  });

  it("reports a URI from an inaccessible group as unknown-group", async function () {
    const state = createStubState();

    assertInaccessible(
      await check(groupURI(42, "MISSING01"), state),
      "unknown-group",
    );
  });

  it("accepts an item from an accessible group", async function () {
    const state = createStubState({
      groupItems: new Map([
        [42, new Map([["ITEM0001", { id: 9, deleted: false }]])],
      ]),
    });

    assertAccessible(await check(groupURI(42, "ITEM0001"), state));
  });
});
