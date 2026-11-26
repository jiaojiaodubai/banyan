import { assert } from "chai";
import { config } from "../package.json";

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
  return {
    id,
    isRegularItem: () => true,
    isEditable: () => true,
  } as Zotero.Item;
}

function openIO(itemID: number): {
  itemID: number;
  deferred: { resolve: () => void };
} {
  return { itemID, deferred: { resolve: () => {} } };
}

class FakeLocalization {
  formatMessagesSync(messages: { id: string }[]) {
    return messages.map(({ id }) => ({ value: `[[${id}]]` }));
  }
}

describe("item editor dialog window", function () {
  let openItemEditor: (typeof import("../src/modules/itemEditorWindow"))["openItemEditor"];

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

    ({ openItemEditor } = await import("../src/modules/itemEditorWindow"));
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

  it("opens one modal item editor at the requested position", function () {
    void openItemEditor(fakeItem(7), {
      initialField: "title",
      initialCreatorIndex: 2,
    });

    assert.lengthOf(opened, 1);
    assert.match(opened[0].url, /itemEditorDialog\.xhtml$/);
    assert.equal(opened[0].name, "banyan-item-editor");
    assert.include(opened[0].features, "chrome");
    assert.include(opened[0].features, "modal");
    assert.deepInclude(opened[0].io as Record<string, unknown>, {
      itemID: 7,
      initialField: "title",
      initialCreatorIndex: 2,
    });
  });

  it("reuses the open editor instead of stacking a second one", function () {
    const existing = fakeWindow({
      name: "banyan-item-editor",
      arguments: [openIO(5)],
    });
    enumerated.push(existing);

    void openItemEditor(fakeItem(5));

    assert.isEmpty(opened);
    assert.isTrue(existing.focused);
    assert.isEmpty(notices);
  });

  it("warns when the open editor shows another item", function () {
    const existing = fakeWindow({
      name: "banyan-item-editor",
      arguments: [openIO(5)],
    });
    enumerated.push(existing);

    void openItemEditor(fakeItem(6));

    assert.isEmpty(opened);
    assert.isTrue(existing.focused);
    assert.lengthOf(notices, 1);
    assert.include(notices[0], "item-editor-already-open");
  });

  it("opens a new editor after the previous one closed", function () {
    enumerated.push(fakeWindow({ name: "banyan-item-editor", closed: true }));

    void openItemEditor(fakeItem(3));

    assert.lengthOf(opened, 1);
  });
});
