import { assert } from "chai";
import type { CitationContext } from "../typings/style";

type StubItem = {
  id: number;
  key: string;
  uri: string;
  title: string;
  deleted: boolean;
};

type StubState = {
  /** Item key -> item, as stored in the local user library. */
  items: Map<string, StubItem>;
  /** Replaced URI -> surviving items, i.e. `dc:replaces` relation objects. */
  replacements: Map<string, StubItem[]>;
  /** Account user ID, or null while the account has never been synced. */
  accountUserID: number | null;
  localUserKey: string;
};

const LOCAL_USER_KEY = "LocalKey1";
const ACCOUNT_USER_ID = 7264;

const accountURI = (key: string) =>
  `http://zotero.org/users/${ACCOUNT_USER_ID}/items/${key}`;
const localURI = (key: string) =>
  `http://zotero.org/users/local/${LOCAL_USER_KEY}/items/${key}`;
const otherLocalURI = (key: string) =>
  `http://zotero.org/users/local/OtherKey/items/${key}`;

const URI_PATTERN =
  /^http:\/\/zotero\.org\/(users|groups)\/(local\/)?(\w+)(?:\/(?:publications|feeds\/\w+))?\/items\/(\w+)$/;

function createStubState(overrides: Partial<StubState> = {}): StubState {
  return {
    items: new Map(),
    replacements: new Map(),
    accountUserID: ACCOUNT_USER_ID,
    localUserKey: LOCAL_USER_KEY,
    ...overrides,
  };
}

/** Shape accepted by `toBanyanItem`, backed by a `StubItem`. */
function createLiveItem(item: StubItem) {
  return {
    id: item.id,
    deleted: item.deleted,
    uri: item.uri,
    firstCreator: "Smith",
    toJSON: () => ({ itemType: "book", title: item.title }),
    getField: (field: string) => (field === "year" ? "2024" : ""),
  };
}

/**
 * Minimal stand-in for the Zotero APIs the refresh pipeline touches. Group
 * libraries are not exercised here, so group URIs never resolve.
 */
function installZoteroStub(state: StubState): void {
  const findByKey = (key: string) => {
    const item = state.items.get(key);
    return item ? createLiveItem(item) : false;
  };

  (globalThis as Record<string, unknown>).ztoolkit = { logError: () => {} };
  (globalThis as Record<string, unknown>).Zotero = {
    ItemFields: {
      getID: () => false,
      getBaseIDFromTypeAndField: () => false,
      getName: () => "",
    },
    URI: {
      getCurrentUserURI: () =>
        state.accountUserID
          ? `http://zotero.org/users/${state.accountUserID}`
          : `http://zotero.org/users/local/${state.localUserKey}`,
      getLocalUserURI: () =>
        `http://zotero.org/users/local/${state.localUserKey}`,
      getItemURI: (item: { uri: string }) => item.uri,
      getURIItem: async (uri: string) => {
        const parsed = URI_PATTERN.exec(uri);
        if (!parsed) {
          throw new Error(`Could not parse object URI ${uri}`);
        }
        const [, libraryType, , , itemKey] = parsed;
        return libraryType === "groups" ? false : findByKey(itemKey);
      },
    },
    Relations: {
      replacedItemPredicate: "dc:replaces",
      getByPredicateAndObject: (
        _objectType: string,
        _predicate: string,
        object: string,
      ) =>
        Promise.resolve(
          (state.replacements.get(object) ?? []).map(createLiveItem),
        ),
    },
    Items: {
      getAsync: async (id: number) => {
        for (const item of state.items.values()) {
          if (item.id === id) {
            return createLiveItem(item);
          }
        }
        return false;
      },
    },
    Groups: {
      get: () => false,
    },
  };
}

function createContext(
  id: string,
  cites: Array<{ id: number; uri: string }>,
): CitationContext {
  return {
    id,
    page: 1,
    params: {},
    cites: cites.map((cite) => ({ item: { ...cite } })),
  } as unknown as CitationContext;
}

describe("refresh-side context handling", function () {
  let syncContextsWithLiveItems: (typeof import("../src/utils/item"))["syncContextsWithLiveItems"];
  let scanInaccessibleItems: (typeof import("../src/modules/inaccessibleItems"))["scanInaccessibleItems"];

  before(async function () {
    installZoteroStub(createStubState());
    ({ syncContextsWithLiveItems } = await import("../src/utils/item"));
    ({ scanInaccessibleItems } =
      await import("../src/modules/inaccessibleItems"));
  });

  after(function () {
    const global = globalThis as Record<string, unknown>;
    delete global.Zotero;
    delete global.ztoolkit;
  });

  describe("syncContextsWithLiveItems", function () {
    it("replaces the URI of a cite whose item was merged away", async function () {
      const mergedAwayUri = localURI("MERGED01");
      const survivor: StubItem = {
        id: 2,
        key: "SURVIVOR",
        uri: accountURI("SURVIVOR"),
        title: "Surviving Copy",
        deleted: false,
      };
      const state = createStubState({
        items: new Map([
          [
            "MERGED01",
            {
              id: 1,
              key: "MERGED01",
              uri: mergedAwayUri,
              title: "Merged Away",
              deleted: true,
            },
          ],
        ]),
        replacements: new Map([[mergedAwayUri, [survivor]]]),
      });
      installZoteroStub(state);

      const contexts = [
        createContext("ctx-1", [{ id: 1, uri: mergedAwayUri }]),
      ];
      const [synced] = await syncContextsWithLiveItems(contexts);

      assert.equal(synced.cites[0].item.id, 2);
      assert.equal(synced.cites[0].item.uri, accountURI("SURVIVOR"));
      assert.equal(synced.cites[0].item.title, "Surviving Copy");
      // The incoming contexts stay untouched: the endpoint owns the copy it
      // passes on to the sandbox.
      assert.equal(contexts[0].cites[0].item.id, 1);
      assert.equal(contexts[0].cites[0].item.uri, mergedAwayUri);
    });

    it("prefers items imported during this refresh", async function () {
      const imported: StubItem = {
        id: 5,
        key: "IMPORTED",
        uri: accountURI("IMPORTED"),
        title: "Imported Copy",
        deleted: false,
      };
      installZoteroStub(createStubState());

      const contexts = [
        createContext("ctx-1", [{ id: 1, uri: accountURI("MISSING01") }]),
      ];
      const [synced] = await syncContextsWithLiveItems(
        contexts,
        new Map([[accountURI("MISSING01"), createLiveItem(imported)]]),
      );

      assert.equal(synced.cites[0].item.id, 5);
      assert.equal(synced.cites[0].item.uri, accountURI("IMPORTED"));
    });

    it("keeps the cached snapshot when the item cannot be resolved", async function () {
      installZoteroStub(createStubState());

      const contexts = [
        createContext("ctx-1", [{ id: 999, uri: accountURI("MISSING01") }]),
      ];
      const [synced] = await syncContextsWithLiveItems(contexts);

      assert.equal(synced.cites[0].item.id, 999);
      assert.equal(synced.cites[0].item.uri, accountURI("MISSING01"));
    });

    it("preserves the other context fields", async function () {
      installZoteroStub(createStubState());

      const contexts = [createContext("ctx-1", [])];
      const synced = await syncContextsWithLiveItems(contexts);

      assert.lengthOf(synced, 1);
      assert.equal(synced[0].id, "ctx-1");
      assert.equal(synced[0].page, 1);
      assert.notStrictEqual(synced[0], contexts[0]);
    });
  });

  describe("scanInaccessibleItems", function () {
    it("reports each inaccessible item once, no matter how often it is cited", async function () {
      const state = createStubState({
        items: new Map([
          [
            "DELETED1",
            {
              id: 1,
              key: "DELETED1",
              uri: localURI("DELETED1"),
              title: "Deleted",
              deleted: true,
            },
          ],
        ]),
      });
      installZoteroStub(state);

      const contexts = [
        createContext("ctx-1", [
          { id: 1, uri: localURI("DELETED1") },
          { id: 1, uri: localURI("DELETED1") },
        ]),
        createContext("ctx-2", [{ id: 1, uri: localURI("DELETED1") }]),
      ];
      const inaccessible = await scanInaccessibleItems(contexts);

      assert.lengthOf(inaccessible, 1);
      assert.equal(inaccessible[0].reason, "deleted");
      assert.equal(inaccessible[0].contextId, "ctx-1");
    });

    it("skips items that resolve through a merge relation", async function () {
      const mergedAwayUri = localURI("MERGED01");
      const state = createStubState({
        items: new Map([
          [
            "MERGED01",
            {
              id: 1,
              key: "MERGED01",
              uri: mergedAwayUri,
              title: "Merged Away",
              deleted: true,
            },
          ],
        ]),
        replacements: new Map([
          [
            mergedAwayUri,
            [
              {
                id: 2,
                key: "SURVIVOR",
                uri: accountURI("SURVIVOR"),
                title: "Surviving Copy",
                deleted: false,
              },
            ],
          ],
        ]),
      });
      installZoteroStub(state);

      const inaccessible = await scanInaccessibleItems([
        createContext("ctx-1", [{ id: 1, uri: mergedAwayUri }]),
      ]);

      assert.lengthOf(inaccessible, 0);
    });

    it("classifies items from another install as cross-library", async function () {
      installZoteroStub(createStubState());

      const inaccessible = await scanInaccessibleItems([
        createContext("ctx-1", [
          { id: 1, uri: otherLocalURI("MISSING01") },
          { id: 2, uri: accountURI("MISSING02") },
        ]),
      ]);

      assert.deepEqual(
        inaccessible.map((info) => info.reason),
        ["cross-library", "deleted"],
      );
      assert.equal(inaccessible[0].uri, otherLocalURI("MISSING01"));
    });
  });
});
