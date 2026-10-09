import { assert } from "chai";
import { config } from "../package.json";

/**
 * Menu entries registered through `Zotero.MenuManager` resolve their target in
 * two places — `onShowing` decides whether the entry is visible, `onCommand`
 * runs it — so both must agree on the same predicate. A hidden entry cannot be
 * activated, but a stale `onCommand` would still open a window for a selection
 * the entry was never shown for.
 */

type MenuItem = {
  menuType: string;
  l10nID?: string;
  onShowing?: (event: unknown, context: unknown) => void;
  onCommand?: (event: unknown, context: unknown) => void;
  menus?: MenuItem[];
};

type RegisteredMenu = {
  menuID: string;
  target: string;
  menus: MenuItem[];
};

type FakeItem = {
  id: number;
  isRegularItem: () => boolean;
  isEditable: () => boolean;
};

type PaneSelection = {
  canEdit: boolean;
  items: FakeItem[];
};

const registered: RegisteredMenu[] = [];
const opened: Array<{
  url: string;
  name: string;
  features: string;
  io: unknown;
}> = [];
const notices: Array<{ text: string; type?: string }> = [];
const enumerated: FakeWindow[] = [];
type FakeWindow = {
  name: string;
  closed: boolean;
  focused: boolean;
  focus: () => void;
  arguments?: unknown[];
};

let paneSelection: PaneSelection;
let openShouldThrow = false;

function fakeItem(
  id: number,
  { regular = true, editable = true } = {},
): FakeItem {
  return { id, isRegularItem: () => regular, isEditable: () => editable };
}

/** An open dialog window, as `findWindowByName` and the focus path see it. */
function fakeOpenWindow(name: string, itemID: number): FakeWindow {
  const win: FakeWindow = {
    name,
    closed: false,
    focused: false,
    focus: () => {
      win.focused = true;
    },
    arguments: [{ itemID, deferred: { resolve: () => {} } }],
  };
  return win;
}

/** Stand-in for the chrome `Localization` the l10n helper builds on demand. */
class FakeLocalization {
  formatMessagesSync(messages: { id: string }[]) {
    return messages.map(({ id }) => ({ value: `[[${id}]]` }));
  }
}

/** Depth-first search for a menu entry by its l10n id, within one target. */
function menuItemIn(target: string, id: string): MenuItem {
  const wanted = `${config.addonRef}-${id}`;
  const walk = (items: MenuItem[]): MenuItem | null => {
    for (const item of items) {
      if (item.l10nID === wanted) {
        return item;
      }
      const nested = item.menus ? walk(item.menus) : null;
      if (nested) {
        return nested;
      }
    }
    return null;
  };
  const menu = registered.find((entry) => entry.target === target);
  assert.isDefined(menu, `no menu registered for target ${target}`);
  const found = walk(menu?.menus ?? []);
  assert.isNotNull(found, `${wanted} is not registered on ${target}`);
  return found as MenuItem;
}

/** Run an `onShowing` handler and report what it decided. */
function visibilityFor(item: MenuItem | undefined, context: unknown): boolean {
  let visible: boolean | null = null;
  item?.onShowing?.(new Event("popupshowing"), {
    ...(context as object),
    setVisible: (value: boolean) => {
      visible = value;
    },
  });
  assert.isNotNull(visible, "onShowing did not call setVisible");
  return visible as unknown as boolean;
}

describe("creators-ext menu entries", function () {
  let menu: typeof import("../src/modules/menu");

  before(async function () {
    const global = globalThis as Record<string, unknown>;
    global.ztoolkit = {
      log: () => {},
      logError: () => {},
      getGlobal: () => FakeLocalization,
      ProgressWindow: function (this: unknown) {
        return {
          createLine: (line: { text: string; type?: string }) => {
            notices.push(line);
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
      ItemFields: {
        getID: () => false,
        getBaseIDFromTypeAndField: () => false,
        getName: () => "",
      },
      URI: { getItemURI: () => "http://zotero.org/users/local/X/items/KEY1" },
      CreatorTypes: { getName: () => "author", getID: () => false },
      MenuManager: {
        registerMenu: (definition: RegisteredMenu) => {
          registered.push(definition);
        },
      },
      getActiveZoteroPane: () => ({
        canEdit: () => paneSelection.canEdit,
        getSelectedItems: () => paneSelection.items,
      }),
      getMainWindow: () => ({
        openDialog: (
          url: string,
          name: string,
          features: string,
          io: unknown,
        ) => {
          if (openShouldThrow) {
            throw new Error("window open failed");
          }
          opened.push({ url, name, features, io });
          return {};
        },
      }),
    };

    menu = await import("../src/modules/menu");
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
    registered.length = 0;
    opened.length = 0;
    notices.length = 0;
    enumerated.length = 0;
    openShouldThrow = false;
    paneSelection = { canEdit: true, items: [fakeItem(7)] };
    menu.registerContextMenu();
  });

  describe("item context menu entry", function () {
    const itemEntry = () =>
      menuItemIn("main/library/item", "menuitem-creators-ext");

    it("shows for exactly one editable regular item", function () {
      assert.isTrue(visibilityFor(itemEntry(), {}));
    });

    it("hides when nothing is selected", function () {
      paneSelection = { canEdit: true, items: [] };

      assert.isFalse(visibilityFor(itemEntry(), {}));
    });

    it("hides for a multiple selection", function () {
      paneSelection = { canEdit: true, items: [fakeItem(7), fakeItem(8)] };

      assert.isFalse(visibilityFor(itemEntry(), {}));
    });

    it("hides when the selection carries a note or attachment", function () {
      // `selectedCount` counts the raw selection: one item plus an attachment
      // is not "one item" for a window that edits a single item's creators.
      paneSelection = {
        canEdit: true,
        items: [fakeItem(7), fakeItem(9, { regular: false })],
      };

      assert.isFalse(visibilityFor(itemEntry(), {}));
    });

    it("hides in a read-only view and for a read-only item", function () {
      paneSelection = { canEdit: false, items: [fakeItem(7)] };
      assert.isFalse(visibilityFor(itemEntry(), {}));

      paneSelection = {
        canEdit: true,
        items: [fakeItem(7, { editable: false })],
      };
      assert.isFalse(visibilityFor(itemEntry(), {}));
    });

    it("opens the window for the selected item", function () {
      itemEntry().onCommand?.(new Event("command"), {});

      assert.lengthOf(opened, 1);
      assert.match(opened[0].url, /creatorsExtDialog\.xhtml$/);
      assert.equal(opened[0].name, `${config.addonRef}-creators-ext-dialog`);
      assert.include(opened[0].features, "modal");
      assert.deepInclude(opened[0].io as { itemID: number }, { itemID: 7 });
    });

    it("does nothing when the entry does not apply", function () {
      paneSelection = { canEdit: true, items: [] };

      itemEntry().onCommand?.(new Event("command"), {});

      assert.isEmpty(opened);
      assert.isEmpty(notices);
    });

    it("reports a window that could not be opened", async function () {
      openShouldThrow = true;

      itemEntry().onCommand?.(new Event("command"), {});

      // The menu handler handles the rejection asynchronously.
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.lengthOf(notices, 1);
      assert.match(notices[0].text, /creators-ext-open-failed/);
    });
  });

  describe("creator row menu entry", function () {
    const rowEntry = () =>
      menuItemIn("itemPane/info/row", "menuitem-creators-ext");

    const rowContext = (
      overrides: Partial<{
        items: FakeItem[];
        editable: boolean;
        fieldName: string | undefined;
      }> = {},
    ) => ({
      items: [fakeItem(7)],
      editable: true,
      fieldName: "creator-0-lastName",
      ...overrides,
    });

    it("shows for a creator row of an editable regular item", function () {
      assert.isTrue(visibilityFor(rowEntry(), rowContext()));
    });

    it("shows for every part of the creator row", function () {
      for (const fieldName of [
        "creator-2-firstName",
        "creator-1-typeID",
        "creator-10-lastName",
      ]) {
        assert.isTrue(
          visibilityFor(rowEntry(), rowContext({ fieldName })),
          `${fieldName} should be a creator row`,
        );
      }
    });

    it("hides outside a creator row", function () {
      for (const fieldName of [
        "title",
        "date",
        "creator-lastName",
        "creator-x-lastName",
        undefined,
      ]) {
        assert.isFalse(
          visibilityFor(rowEntry(), rowContext({ fieldName })),
          `${String(fieldName)} should not match`,
        );
      }
    });

    it("hides for a multiple selection, a read-only pane or a non-editable item", function () {
      for (const overrides of [
        { items: [fakeItem(7), fakeItem(8)] },
        { editable: false },
        { items: [fakeItem(7, { regular: false })] },
        { items: [fakeItem(7, { editable: false })] },
      ]) {
        assert.isFalse(
          visibilityFor(rowEntry(), rowContext(overrides)),
          JSON.stringify(overrides),
        );
      }
    });

    it("opens the window focused on the creator row that was clicked", function () {
      rowEntry().onCommand?.(
        new Event("command"),
        rowContext({ fieldName: "creator-2-firstName" }),
      );

      assert.lengthOf(opened, 1);
      assert.deepInclude(
        opened[0].io as { itemID: number; focusCreatorIndex?: number },
        { itemID: 7, focusCreatorIndex: 2 },
      );
    });

    it("focuses an already open window instead of opening a second one", function () {
      enumerated.push(
        fakeOpenWindow(`${config.addonRef}-creators-ext-dialog`, 7),
      );

      rowEntry().onCommand?.(new Event("command"), rowContext());

      assert.isEmpty(opened);
      assert.isTrue(enumerated[0].focused);
      // The open window already shows this item: nothing to report.
      assert.isEmpty(notices);
    });
  });
});
