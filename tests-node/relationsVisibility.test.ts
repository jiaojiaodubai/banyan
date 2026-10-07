import { assert } from "chai";
import { getVisibleMultilingualItems } from "../src/modules/relations";

// The listing helper only reads `id`, `deleted`, and `getRelations()`.
function makeItem(id: number, related: number[] = [], deleted = false) {
  return {
    id,
    deleted,
    getRelations: () => ({
      "banyan:multilingual": related.map(
        (relatedID) => `http://zotero.org/users/1/items/${relatedID}`,
      ),
    }),
  } as unknown as Zotero.Item;
}

/** Resolve group URIs the way `Zotero.URI.getURIItem` does on a real library. */
function stubUriLookup(items: Zotero.Item[]): void {
  const byUri = new Map(
    items.map((item) => [`http://zotero.org/users/1/items/${item.id}`, item]),
  );
  (globalThis as unknown as { Zotero: unknown }).Zotero = {
    URI: { getURIItem: async (uri: string) => byUri.get(uri) ?? false },
  };
}

function ids(items: Zotero.Item[]): number[] {
  return items.map((item) => item.id);
}

describe("multilingual member listing", function () {
  it("hides trashed members while the item itself is live", async function () {
    const livePeer = makeItem(11);
    const trashedPeer = makeItem(12, [], true);
    const item = makeItem(10, [11, 12]);
    stubUriLookup([item, livePeer, trashedPeer]);

    assert.deepEqual(ids(await getVisibleMultilingualItems(item)), [11]);
  });

  it("keeps trashed members while the item itself is trashed", async function () {
    const livePeer = makeItem(21);
    const trashedPeer = makeItem(22, [], true);
    const item = makeItem(20, [21, 22], true);
    stubUriLookup([item, livePeer, trashedPeer]);

    assert.deepEqual(ids(await getVisibleMultilingualItems(item)), [21, 22]);
  });
});
