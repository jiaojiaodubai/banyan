import { assert } from "chai";
import { config } from "../package.json";

/**
 * The debug dialog opens the server-owned dialogs (style / citation /
 * bibliography) from plain library data, so a maintainer can exercise them
 * without the WPS add-in driving the HTTP server.
 */

type OpenCall = {
  url: string;
  features: string;
  io: unknown;
};

const opened: OpenCall[] = [];
const errors: string[] = [];

let styleFiles: Map<string, unknown>;
let selectedItems: Array<{ isRegularItem: () => boolean }>;

function fakeItem(
  overrides: Partial<{
    id: number;
    title: string;
    itemType: string;
    isRegular: boolean;
  }> = {},
) {
  const {
    id = 1,
    title = "Title",
    itemType = "book",
    isRegular = true,
  } = overrides;
  return {
    id,
    toJSON: () => ({ itemType, title, id }),
    getField: (field: string) => (field === "year" ? "2000" : ""),
    firstCreator: "Doe",
    isRegularItem: () => isRegular,
  };
}

function makeZotero() {
  return {
    Prefs: { get: () => "", set: () => {} },
    getActiveZoteroPane: () => ({ getSelectedItems: () => selectedItems }),
    ItemFields: {
      getID: () => false,
      getBaseIDFromTypeAndField: () => false,
      getName: () => "",
    },
    URI: { getItemURI: (item: { id: number }) => `uri://${item.id}` },
    Utilities: { Internal: { activate: () => {} } },
    debug: () => {},
    log: (message: string, level?: string) => {
      if (level === "warning") errors.push(message);
    },
  };
}

describe("debug dialog server helpers", function () {
  let debug: typeof import("../src/modules/debug");

  before(async function () {
    const global = globalThis as Record<string, unknown>;
    global.ztoolkit = {
      log: () => {},
      logError: (message: unknown) => errors.push(String(message)),
    };
    global.addon = {
      data: {
        config,
        ztoolkit: global.ztoolkit,
        styles: { files: undefined, cache: new Map() },
      },
    };
    global.Services = {
      wm: {
        getEnumerator: () => ({
          hasMoreElements: () => false,
          getNext: () => null,
        }),
      },
      ww: {
        openWindow: (
          _parent: unknown,
          url: string,
          _name: string,
          features: string,
          io: unknown,
        ) => {
          opened.push({ url, features, io });
          return { addEventListener: () => {}, closed: false };
        },
      },
    };
    global.Zotero = makeZotero();

    debug = await import("../src/modules/debug");
  });

  after(function () {
    const global = globalThis as Record<string, unknown>;
    delete global.Zotero;
    delete global.ztoolkit;
    delete global.addon;
    delete global.Services;
  });

  beforeEach(function () {
    opened.length = 0;
    errors.length = 0;
    (globalThis as Record<string, unknown>).Zotero = makeZotero();
    selectedItems = [fakeItem({ id: 1, title: "Alpha" })];
    styleFiles = new Map([
      ["style-b", { id: "style-b", title: "Beta", citationType: "note" }],
      [
        "style-a",
        {
          id: "style-a",
          title: "Alpha style",
          citationType: "intext",
          description: "",
          updated: "",
        },
      ],
    ]);
    (addon.data as { styles: { files: Map<string, unknown> } }).styles.files =
      styleFiles as Map<string, never>;
  });

  it("lists styles sorted by title", function () {
    const list = debug.getDebugStyleList();
    assert.deepEqual(
      list.map((style) => style.title),
      ["Alpha style", "Beta"],
    );
  });

  it("builds a citation request from the selection", function () {
    const data = debug.getDebugCitationRequestData();

    assert.isNotNull(data);
    assert.equal(data!.documentId, "banyan-debug");
    assert.equal((data!.style as { id?: string }).id, "style-a");
    assert.equal(data!.source?.cites[0].item.title, "Alpha");
  });

  it("builds a bibliography request whose line carries the cite titles", function () {
    const data = debug.getDebugBibliographyRequestData();

    assert.isNotNull(data);
    assert.equal(data!.documentId, "banyan-debug");
    assert.equal((data!.style as { id?: string }).id, "style-a");
    assert.equal(data!.line.content.text, "Alpha");
    assert.lengthOf(data!.extraSource?.cites ?? [], 1);
  });

  it("skips non-regular items in the selection", function () {
    selectedItems = [
      fakeItem({ id: 1, title: "Alpha" }),
      fakeItem({ id: 2, title: "Note", isRegular: false }),
    ];

    const data = debug.getDebugCitationRequestData();

    assert.equal(data!.source?.cites.length, 1);
    assert.equal(data!.source?.cites[0].item.title, "Alpha");
  });

  it("returns nothing when nothing usable is selected", function () {
    selectedItems = [];

    assert.isNull(debug.getDebugCitationRequestData());
    assert.isNull(debug.getDebugBibliographyRequestData());
  });

  it("opens the style dialog against the first style of the sorted list", function () {
    void debug.openDebugStyleDialog();

    assert.lengthOf(opened, 1);
    assert.match(opened[0].url, /styleDialog\.xhtml$/);
    // `openDialogWindow` wraps the IO; the dialog unwraps it.
    const io = opened[0].io as {
      wrappedJSObject: { data: { id: string; title: string } };
    };
    assert.deepInclude(io.wrappedJSObject.data, {
      id: "style-a",
      title: "Alpha style",
    });
  });

  it("reports instead of opening when no style is loaded", function () {
    (addon.data as { styles: { files: Map<string, unknown> } }).styles.files =
      new Map();

    void debug.openDebugStyleDialog();

    assert.isEmpty(opened);
    assert.lengthOf(errors, 1);
  });
});
