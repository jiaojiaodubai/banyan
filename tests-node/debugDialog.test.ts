import { assert } from "chai";
import { config } from "../package.json";
import type { CitationDialogRequestData } from "../typings/server";

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
/** What the plugin wrote to Zotero's error console. */
const reported: string[] = [];

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
    // The plugin's logger writes debug output to `debug` and anything the user
    // should see to the error console; only the latter is recorded here.
    debug: () => {},
    log: (message: unknown) => reported.push(String(message)),
  };
}

/** `debug` identifies a style by id/title; the request type also allows control declarations. */
const styleIdOf = (data: CitationDialogRequestData) =>
  "id" in data.style ? data.style.id : undefined;

describe("debug dialog server helpers", function () {
  let debug: typeof import("../src/modules/debug");

  before(async function () {
    const global = globalThis as Record<string, unknown>;
    global.ztoolkit = {
      log: () => {},
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
    reported.length = 0;
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
    assert.equal(styleIdOf(data!), "style-a");
    assert.equal(data!.source?.cites[0].item.title, "Alpha");
  });

  it("uses the last used style when it is still indexed", function () {
    const zotero = (globalThis as Record<string, unknown>).Zotero as {
      Prefs: { get: (key: string, global?: boolean) => unknown };
    };
    const originalGet = zotero.Prefs.get;
    zotero.Prefs.get = (key: string) =>
      key.endsWith("lastUsedStyleId") ? "style-b" : "";
    try {
      const data = debug.getDebugCitationRequestData();
      assert.equal(styleIdOf(data!), "style-b");
    } finally {
      zotero.Prefs.get = originalGet;
    }
  });

  it("builds a bibliography request whose line carries the cite titles", function () {
    const data = debug.getDebugBibliographyRequestData();

    assert.isNotNull(data);
    assert.equal(data!.documentId, "banyan-debug");
    assert.equal(styleIdOf(data!), "style-a");
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

  it("still opens an empty citation dialog when nothing is selected", function () {
    selectedItems = [];

    const data = debug.getDebugCitationRequestData();
    assert.isNotNull(data);
    assert.deepEqual(data!.source?.cites, []);
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
    assert.deepEqual(reported, [
      "[debug] no style available for the style dialog",
    ]);
  });
});
