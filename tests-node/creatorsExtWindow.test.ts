import { assert } from "chai";
import { config } from "../package.json";
import {
  isCreatorExtDialogIO,
  unwrapCreatorExtDialogIO,
} from "../src/utils/creatorsExtDialogIO";

/**
 * The creator editor is a single modal window: modal to the window it was
 * opened from (the creator list cannot change underneath it) and reused rather
 * than stacked.
 */

type FakeWindow = {
  name: string;
  closed: boolean;
  arguments?: unknown[];
  focused: boolean;
  focus: () => void;
};

type OpenCall = {
  url: string;
  name: string;
  features: string;
  io: unknown;
};

const opened: OpenCall[] = [];
const notices: string[] = [];
const enumerated: FakeWindow[] = [];

function fakeWindow(overrides: Partial<FakeWindow> = {}): FakeWindow {
  const win: FakeWindow = {
    name: "",
    closed: false,
    focused: false,
    focus: () => {
      win.focused = true;
    },
    ...overrides,
  };
  return win;
}

function fakeItem(id: number): Zotero.Item {
  return { id } as Zotero.Item;
}

/** The IO the dialog was opened with, in the shape the opener writes. */
function openIO(itemID: number): {
  itemID: number;
  deferred: { resolve: () => void };
} {
  return { itemID, deferred: { resolve: () => {} } };
}

/** Stand-in for the chrome `Localization` the l10n helper builds on demand. */
class FakeLocalization {
  formatMessagesSync(messages: { id: string }[]) {
    return messages.map(({ id }) => ({ value: `[[${id}]]` }));
  }
}

describe("creators-ext dialog window", function () {
  describe("IO contract", function () {
    const io = { itemID: 7, deferred: { resolve: () => {} } };

    it("accepts the argument the opener passed through", function () {
      // `openMainWindowDialog` passes the IO itself…
      assert.strictEqual(unwrapCreatorExtDialogIO(io), io);
      // …while `openDialogWindow` wraps it, and Gecko may Xray-wrap that.
      assert.strictEqual(unwrapCreatorExtDialogIO({ wrappedJSObject: io }), io);
      assert.isNull(
        unwrapCreatorExtDialogIO({ wrappedJSObject: { wrappedJSObject: io } }),
      );
    });

    it("rejects anything without a deferred resolver", function () {
      assert.isFalse(isCreatorExtDialogIO({ itemID: 1 }));
      assert.isFalse(isCreatorExtDialogIO(null));
      assert.isFalse(isCreatorExtDialogIO(undefined));
      assert.isFalse(isCreatorExtDialogIO("itemID"));
      assert.isNull(unwrapCreatorExtDialogIO(undefined));
      assert.isNull(unwrapCreatorExtDialogIO({ wrappedJSObject: {} }));
    });
  });

  let openCreatorsExtDialog: (typeof import("../src/modules/creatorsExt"))["openCreatorsExtDialog"];

  before(async function () {
    const global = globalThis as Record<string, unknown>;
    global.ztoolkit = {
      log: () => {},
      logError: () => {},
      getGlobal: () => FakeLocalization,
      ProgressWindow: function (this: unknown) {
        return {
          createLine: ({ text }: { text: string }) => {
            notices.push(text);
            return { show: () => {} };
          },
          show: () => {},
        };
      },
    };
    global.addon = { data: { config, ztoolkit: global.ztoolkit } };
    global.Components = { utils: { isDeadWrapper: () => false } };
    global.Services = {
      wm: {
        getEnumerator: () => {
          let index = 0;
          return {
            hasMoreElements: () => index < enumerated.length,
            getNext: () => enumerated[index++],
          };
        },
      },
      ww: {
        openWindow: (
          _parent: unknown,
          url: string,
          name: string,
          features: string,
          io: unknown,
        ) => {
          opened.push({ url, name, features, io });
          return {};
        },
      },
    };
    global.Zotero = {
      // `src/modules/server` builds a ProgressBar at module scope.
      Prefs: { get: () => "", set: () => {} },
      getMainWindow: () => ({
        openDialog: (
          url: string,
          name: string,
          features: string,
          io: unknown,
        ) => {
          opened.push({ url, name, features, io });
          return {};
        },
      }),
    };

    ({ openCreatorsExtDialog } = await import("../src/modules/creatorsExt"));
  });

  after(function () {
    const global = globalThis as Record<string, unknown>;
    delete global.Zotero;
    delete global.ztoolkit;
    delete global.addon;
    delete global.Components;
    delete global.Services;
  });

  beforeEach(function () {
    opened.length = 0;
    notices.length = 0;
    enumerated.length = 0;
  });

  it("opens a single modal dialog named after the plugin", function () {
    void openCreatorsExtDialog(fakeItem(7), 2);

    assert.lengthOf(opened, 1);
    assert.match(opened[0].url, /creatorsExtDialog\.xhtml$/);
    assert.equal(opened[0].name, `${config.addonRef}-creators-ext-dialog`);
    assert.include(opened[0].features, "chrome");
    assert.include(opened[0].features, "modal");
    assert.include(opened[0].features, "resizable=yes");
    // `dialog=no` would drop the modality.
    assert.notInclude(opened[0].features, "dialog=no");
    assert.deepInclude(
      opened[0].io as { itemID: number; focusCreatorIndex?: number },
      { itemID: 7, focusCreatorIndex: 2 },
    );
  });

  it("brings the open dialog to the front instead of stacking one", function () {
    const existing = fakeWindow({
      name: `${config.addonRef}-creators-ext-dialog`,
      arguments: [openIO(5)],
    });
    enumerated.push(existing);

    void openCreatorsExtDialog(fakeItem(5));

    assert.isEmpty(opened);
    assert.isTrue(existing.focused);
    // The open dialog already shows this item: nothing to report.
    assert.isEmpty(notices);
  });

  it("tells the user when the open dialog shows another item", function () {
    const existing = fakeWindow({
      name: `${config.addonRef}-creators-ext-dialog`,
      arguments: [openIO(5)],
    });
    enumerated.push(existing);

    void openCreatorsExtDialog(fakeItem(6));

    assert.isEmpty(opened);
    assert.isTrue(existing.focused);
    assert.lengthOf(notices, 1);
    assert.include(notices[0], "creators-ext-already-open");
  });

  it("reads the item a wrapped IO refers to", function () {
    const existing = fakeWindow({
      name: `${config.addonRef}-creators-ext-dialog`,
      arguments: [{ wrappedJSObject: openIO(9) }],
    });
    enumerated.push(existing);

    void openCreatorsExtDialog(fakeItem(9));

    assert.isEmpty(opened);
    assert.isEmpty(notices);
  });

  it("opens a new dialog once the previous one is gone", function () {
    enumerated.push(
      fakeWindow({
        name: `${config.addonRef}-creators-ext-dialog`,
        closed: true,
      }),
    );

    void openCreatorsExtDialog(fakeItem(3));

    assert.lengthOf(opened, 1);
  });

  it("still opens without a main window to be modal to", function () {
    (globalThis as Record<string, unknown>).Zotero = {
      Prefs: { get: () => "", set: () => {} },
      getMainWindow: () => null,
    };

    void openCreatorsExtDialog(fakeItem(4));

    assert.lengthOf(opened, 1);
    assert.include(opened[0].features, "modal");
  });
});
