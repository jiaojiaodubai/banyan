import { assert } from "chai";
import type { CitationContext, IntextCitation } from "../typings/style";

type StubRef = { libraryID?: number; id?: number; name?: string };

type StubCondition = {
  condition: string;
  operator: string;
  value: unknown;
};

let rowIDCounter = 0;

class StubRow {
  view: StubView;
  type: string;
  ref: StubRef;
  level: number;
  isOpen: boolean;
  _id?: string;

  constructor(
    view: StubView,
    type: string,
    ref: StubRef,
    level = 0,
    isOpen = false,
  ) {
    this.view = view;
    this.type = type;
    this.ref = ref;
    this.level = level;
    this.isOpen = isOpen;
  }

  /** Same id mapping as `Zotero.CollectionTreeRow`, including the `_id` fallback. */
  get id(): string {
    switch (this.type) {
      case "library":
      case "group":
      case "feed":
        return `L${this.ref.libraryID}`;
      case "collection":
        return `C${this.ref.id}`;
      case "search":
        return `S${this.ref.id}`;
      default:
        return (this._id ??= `I${rowIDCounter++}`);
    }
  }

  isLibrary(includeGlobal?: boolean): boolean {
    return includeGlobal
      ? ["library", "group", "feed"].includes(this.type)
      : this.type === "library";
  }
}

class StubSearch {
  libraryID: number;
  name = "";
  conditions = new Map<number, StubCondition>();
  nextConditionID = 1;

  constructor({ libraryID }: { libraryID: number }) {
    this.libraryID = libraryID;
  }

  getConditions(): Record<number, StubCondition> {
    return Object.fromEntries(this.conditions);
  }

  addCondition(condition: string, operator: string, value: unknown): void {
    this.conditions.set(this.nextConditionID++, {
      condition,
      operator,
      value,
    });
  }

  /** Mirrors Zotero: removing a condition renumbers the ones after it. */
  removeCondition(id: number): void {
    const remaining = Array.from(this.conditions.entries())
      .filter(([conditionID]) => conditionID !== id)
      .map(([, condition]) => condition);
    this.conditions.clear();
    this.nextConditionID = 1;
    for (const condition of remaining) {
      this.conditions.set(this.nextConditionID++, condition);
    }
  }
}

const LIBRARY_ID = 1;

class StubView {
  rows: StubRow[] = [];
  reloadCount = 0;
  waitForSelectCount = 0;
  selectedTreeRow: StubRow | undefined;
  /** Mimics Zotero's persisted open state of the library row. */
  libraryOpen = true;
  /** Collection ids in the order the tree lists them. */
  collections: number[] = [1];
  selection = {
    focused: 0,
    count: 1,
    selected: new Set<number>([0]),
    selectEventsSuppressed: false,
    select: (index: number): boolean => {
      this.selection.focused = index;
      this.selection.selected = new Set([index]);
      return true;
    },
  };

  /**
   * Stands in for Zotero's `_expandRow`: decides whether the library shows its
   * children, splices them in, and leaves `isOpen` alone for an on-demand
   * expansion, which `toggleOpenState()` relies on.
   */
  async _expandRow(
    rows: StubRow[],
    row: number,
    forceOpen?: boolean,
  ): Promise<number | false> {
    const treeRow = rows[row];
    if (treeRow.type === "publications") {
      return false;
    }
    if (treeRow.type !== "library") {
      return 0;
    }
    const hasChildren = this.collections.length > 0;
    if (!forceOpen) {
      if (!this.libraryOpen) {
        treeRow.isOpen = false;
        return 0;
      }
      treeRow.isOpen = hasChildren;
    }
    for (const [offset, collectionID] of this.collections.entries()) {
      rows.splice(
        row + 1 + offset,
        0,
        new StubRow(
          this,
          "collection",
          { libraryID: LIBRARY_ID, id: collectionID },
          treeRow.level + 1,
          false,
        ),
      );
    }
    return this.collections.length;
  }

  /** Mirrors Zotero's default: the icon name is the row type. */
  getIconName(index: number): string | null {
    return this.rows[index]?.type ?? null;
  }

  getRow(index: number): StubRow | undefined {
    return this.rows[index];
  }

  getRowIndexByID(id: string): number | false {
    const index = this.rows.findIndex((row) => row.id === id);
    return index === -1 ? false : index;
  }

  /** Mirrors `CollectionTree.refresh()`: rebuild, then suppress selection events. */
  async reload(): Promise<void> {
    this.reloadCount += 1;
    this.rows = [
      new StubRow(this, "library", { libraryID: LIBRARY_ID }, 0, false),
    ];
    await this._expandRow(this.rows, 0);
    this.selection.selectEventsSuppressed = true;
  }

  async waitForSelect(): Promise<void> {
    this.waitForSelectCount += 1;
  }
}

class StubItemsView {
  refreshCount = 0;

  getRow(): { ref: { id: number } } {
    return { ref: { id: 101 } };
  }

  async refreshAndMaintainSelection(): Promise<void> {
    this.refreshCount += 1;
  }
}

class StubLocalization {
  constructor(_resourceIds: string[], _sync: boolean) {}

  formatMessagesSync(messages: Array<{ id: string }>) {
    return messages.map(({ id }) => ({ value: id, attributes: null }));
  }
}

type StubPane = { collectionsView: StubView; itemsView: StubItemsView };

type StubState = {
  view: StubView;
  itemsView: StubItemsView;
  column: Record<string, (...args: never[]) => unknown> | null;
  windows: Array<{ ZoteroPane: StubPane }>;
};

function createStubState(): StubState {
  const view = new StubView();
  const itemsView = new StubItemsView();
  const state: StubState = {
    view,
    itemsView,
    column: null,
    windows: [{ ZoteroPane: { collectionsView: view, itemsView } }],
  };

  const global = globalThis as Record<string, unknown>;
  global.Localization = StubLocalization;
  global.addon = { data: { config: { addonID: "banyan@test" } } };
  global.Zotero = {
    getMainWindows: () => state.windows,
    getMainWindow: () => state.windows[0],
    CollectionTreeRow: StubRow,
    Search: StubSearch,
    Libraries: { userLibraryID: LIBRARY_ID },
    ItemTreeManager: {
      registerColumn: (
        column: Record<string, (...args: never[]) => unknown>,
      ) => {
        state.column = column;
        return "column-key";
      },
      unregisterColumn: () => undefined,
    },
  };

  return state;
}

function createContext(id: string, itemID: number): CitationContext {
  return {
    id,
    page: 1,
    params: {},
    cites: [{ item: { id: itemID, libraryID: LIBRARY_ID } }],
  } as unknown as CitationContext;
}

function createCitation(
  context: CitationContext,
  text: string,
): IntextCitation {
  return {
    id: context.id,
    type: "intext-citation",
    source: context,
    content: { text, marks: [] },
  } as unknown as IntextCitation;
}

function createCellDocument(window: unknown) {
  return {
    defaultView: window,
    createElement: () => ({ className: "", innerHTML: "", title: "" }),
  };
}

const DOCUMENT_ID = "C:\\docs\\Draft.docx";
const SECOND_DOCUMENT_ID = "C:\\docs\\Chapter 01.odt";
const CITED_ROW_ID = `banyanCited:${DOCUMENT_ID}`;

describe("cited-items rows in the collections tree", function () {
  let module: typeof import("../src/modules/citedItemsSearch");

  before(async function () {
    createStubState();
    module = await import("../src/modules/citedItemsSearch");
  });

  after(function () {
    const global = globalThis as Record<string, unknown>;
    delete global.Zotero;
    delete global.Localization;
    delete global.addon;
  });

  describe("after a front-end refresh", function () {
    let state: StubState;

    beforeEach(async function () {
      state = createStubState();
      module.registerCitationColumn();
      const context = createContext("ctx-1", 101);
      await module.updateCitationColumnFromRefresh(
        { documentId: DOCUMENT_ID, contexts: [context] },
        {
          citations: [createCitation(context, "(Smith, 2024)")],
          bibliography: [],
        },
      );
    });

    afterEach(function () {
      module.cleanupCitationColumn();
    });

    it("adds one row per document under the library", function () {
      assert.deepEqual(
        state.view.rows.map((row) => row.id),
        ["L1", "C1", CITED_ROW_ID],
      );
      assert.equal(state.view.rows[2].level, 1);
      assert.deepEqual((state.view.rows[2].ref as StubSearch).getConditions(), {
        1: { condition: "joinMode", operator: "any", value: undefined },
        2: { condition: "itemID", operator: "is", value: 101 },
      });
    });

    it("restores the selection and unsuppresses selection events", async function () {
      // `reload()` leaves the tree suppressed, as Zotero's own does.
      assert.isFalse(state.view.selection.selectEventsSuppressed);
      assert.equal(state.view.waitForSelectCount, 1);

      // The user selects a collection, a new collection appears above it (sync,
      // or a new one in the library), and a second document arrives.
      state.view.selection.focused = 1;
      state.view.collections = [2, 1];
      const context = createContext("ctx-2", 102);
      await module.updateCitationColumnFromRefresh(
        { documentId: SECOND_DOCUMENT_ID, contexts: [context] },
        {
          citations: [createCitation(context, "(Jones, 2025)")],
          bibliography: [],
        },
      );

      assert.equal(state.view.reloadCount, 2);
      // The selection follows the row the user had, not its old index, and the
      // tree responds to clicks again.
      assert.equal(state.view.selection.focused, 2);
      assert.equal(state.view.getRow(2)?.id, "C1");
      assert.isFalse(state.view.selection.selectEventsSuppressed);
      assert.equal(state.view.waitForSelectCount, 2);
      assert.equal(state.itemsView.refreshCount, 2);
    });

    it("keeps the tree as it is while every document row is present", async function () {
      const context = createContext("ctx-1", 101);
      await module.updateCitationColumnFromRefresh(
        { documentId: DOCUMENT_ID, contexts: [context] },
        {
          citations: [createCitation(context, "(Smith, 2024, p. 10)")],
          bibliography: [],
        },
      );

      assert.equal(state.view.reloadCount, 1);
      assert.equal(state.itemsView.refreshCount, 2);
      assert.deepEqual(
        state.view.rows.map((row) => row.id),
        ["L1", "C1", CITED_ROW_ID],
      );
    });

    it("gives the injected row a document icon and leaves the others alone", function () {
      const injected = state.view.getRowIndexByID(CITED_ROW_ID);
      assert.isNotFalse(injected);
      assert.equal(state.view.getIconName(injected as number), "item-type");
      assert.equal(state.view.getIconName(0), "library");
      assert.equal(state.view.getIconName(1), "collection");
    });
  });

  describe("a collapsed library", function () {
    let state: StubState;

    beforeEach(async function () {
      state = createStubState();
      state.view.libraryOpen = false;
      module.registerCitationColumn();
      const context = createContext("ctx-1", 101);
      await module.updateCitationColumnFromRefresh(
        { documentId: DOCUMENT_ID, contexts: [context] },
        {
          citations: [createCitation(context, "(Smith, 2024)")],
          bibliography: [],
        },
      );
    });

    afterEach(function () {
      module.cleanupCitationColumn();
    });

    it("adds the row when the library is expanded by hand", async function () {
      // Its rows are not shown, and the tree is not rebuilt for them either.
      assert.isFalse(state.view.getRowIndexByID(CITED_ROW_ID));
      assert.equal(state.view.reloadCount, 1);

      const rows = state.view.rows;
      const added = await state.view._expandRow(rows, 0, true);

      // The collection row and the document row it pulls in.
      assert.equal(added, 2);
      assert.deepEqual(
        rows.map((row) => row.id),
        ["L1", "C1", CITED_ROW_ID],
      );
    });
  });

  describe("the citation column", function () {
    let state: StubState;

    beforeEach(async function () {
      state = createStubState();
      module.registerCitationColumn();
      const first = createContext("ctx-1", 101);
      const second = createContext("ctx-2", 101);
      await module.updateCitationColumnFromRefresh(
        { documentId: DOCUMENT_ID, contexts: [first] },
        {
          citations: [createCitation(first, "(Smith, 2024)")],
          bibliography: [],
        },
      );
      await module.updateCitationColumnFromRefresh(
        { documentId: SECOND_DOCUMENT_ID, contexts: [second] },
        {
          citations: [createCitation(second, "(Smith, 2025)")],
          bibliography: [],
        },
      );
    });

    afterEach(function () {
      module.cleanupCitationColumn();
    });

    it("shows what every document cites from an ordinary collection", function () {
      state.view.selectedTreeRow = state.view.getRow(1);
      const dataProvider = state.column?.dataProvider as (item: {
        id: number;
      }) => string;

      assert.equal(dataProvider({ id: 101 }), "(Smith, 2024)  (Smith, 2025)");
      assert.equal(dataProvider({ id: 999 }), "");
    });

    it("shows only the selected document's citations on its own row", function () {
      const injected = state.view.getRowIndexByID(CITED_ROW_ID) as number;
      state.view.selectedTreeRow = state.view.getRow(injected);
      const dataProvider = state.column?.dataProvider as (item: {
        id: number;
      }) => string;

      assert.equal(dataProvider({ id: 101 }), "(Smith, 2024)");
    });

    it("renders the merged citations into the cell", function () {
      state.view.selectedTreeRow = state.view.getRow(1);
      const renderCell = state.column?.renderCell as (
        index: number,
        data: unknown,
        column: { className: string },
        isFirstColumn: boolean,
        doc: unknown,
      ) => { innerHTML: string; title: string };

      const cell = renderCell(
        0,
        "",
        { className: "col" },
        false,
        createCellDocument(state.windows[0]),
      );

      assert.include(cell.innerHTML, "(Smith, 2024)");
      assert.include(cell.innerHTML, "(Smith, 2025)");
      assert.equal(cell.title, "(Smith, 2024)  (Smith, 2025)");
    });
  });
});
