import { assert } from "chai";
import { config } from "../package.json";

type MenuItem = {
  l10nID?: string;
  onShowing?: (event: unknown, context: unknown) => void;
  onCommand?: (event: unknown, context: unknown) => void;
};

type Registered = {
  menuID: string;
  target: string;
  menus: MenuItem[];
};

const registered: Registered[] = [];
const opened: Array<{
  url: string;
  name: string;
  features: string;
  io: unknown;
}> = [];
let selection: Array<{
  id: number;
  isRegularItem: () => boolean;
  isEditable: () => boolean;
  itemTypeID: number;
}> = [];

function fakeItem(id = 7): (typeof selection)[number] {
  return {
    id,
    itemTypeID: 2,
    isRegularItem: () => true,
    isEditable: () => true,
  };
}

class FakeLocalization {
  formatMessagesSync(messages: { id: string }[]) {
    return messages.map(({ id }) => ({ value: `[[${id}]]` }));
  }
}

function visibility(item: MenuItem | undefined, context: object): boolean {
  let visible: boolean | null = null;
  item?.onShowing?.(new Event("popupshowing"), {
    ...context,
    setVisible: (value: boolean) => {
      visible = value;
    },
  });
  assert.isNotNull(visible);
  return visible as unknown as boolean;
}

describe("item editor menu entries", function () {
  let itemEditor: typeof import("../src/modules/itemEditorWindow");

  before(async function () {
    const global = globalThis as Record<string, unknown>;
    global.ztoolkit = {
      log: () => {},
      logError: () => {},
      getGlobal: () => FakeLocalization,
      ProgressWindow: function (this: unknown) {
        return { createLine: () => ({ show: () => {} }), show: () => {} };
      },
    };
    global.addon = { data: { config, ztoolkit: global.ztoolkit } };
    global.Components = { utils: { isDeadWrapper: () => false } };
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
      Prefs: { get: () => "", set: () => {} },
      getActiveZoteroPane: () => ({
        canEdit: () => true,
        getSelectedItems: () => selection,
      }),
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
      ItemFields: {
        getID: (name: string) => (name === "title" ? 1 : false),
        getFieldIDFromTypeAndBase: () => 1,
        isValidForType: () => true,
        isDate: () => false,
        isInteger: () => false,
        getBaseIDFromTypeAndField: () => 1,
        getName: () => "title",
      },
      Items: { isPrimaryField: () => false },
      CreatorTypes: { getName: () => "author", getID: () => 8 },
      MenuManager: {
        registerMenu: (definition: Registered) => registered.push(definition),
      },
    };
    itemEditor = await import("../src/modules/itemEditorWindow");
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
    selection = [fakeItem()];
  });

  it("shows Edit Item for one editable regular item", function () {
    const menu = itemEditor.itemEditorItemMenu.build() as MenuItem[];
    assert.isTrue(visibility(menu[0], {}));
    selection = [];
    assert.isFalse(visibility(menu[0], {}));
    selection = [fakeItem(7), fakeItem(8)];
    assert.isFalse(visibility(menu[0], {}));
  });

  it("opens the item editor from the item menu", function () {
    const menu = itemEditor.itemEditorItemMenu.build() as MenuItem[];
    menu[0].onCommand?.({}, {});
    assert.lengthOf(opened, 1);
    assert.match(opened[0].url, /itemEditorDialog\.xhtml$/);
    assert.deepInclude(opened[0].io as Record<string, unknown>, { itemID: 7 });
  });

  it("routes creator and field row menus into the same editor", function () {
    itemEditor.registerItemEditorRowMenus();
    assert.lengthOf(registered, 1);
    const menus = registered[0].menus;
    assert.deepEqual(
      menus.map((menu) => menu.l10nID),
      [`banyan-menuitem-creators-ext`, `banyan-menuitem-mark-field-format`],
    );

    const creatorContext = {
      items: [fakeItem()],
      editable: true,
      fieldName: "creator-0-lastName",
    };
    assert.isTrue(visibility(menus[0], creatorContext));
    menus[0].onCommand?.({}, creatorContext);
    assert.deepInclude(opened[0].io as Record<string, unknown>, {
      itemID: 7,
      initialCreatorIndex: 0,
    });

    opened.length = 0;
    const fieldContext = {
      items: [fakeItem()],
      editable: true,
      fieldName: "title",
    };
    assert.isTrue(visibility(menus[1], fieldContext));
    menus[1].onCommand?.({}, fieldContext);
    assert.deepInclude(opened[0].io as Record<string, unknown>, {
      itemID: 7,
      initialField: "title",
    });
  });
});
