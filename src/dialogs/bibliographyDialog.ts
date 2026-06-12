import type {
  BibliographyRequestData,
  BibliographyResponseData,
  CitationRequestData,
  CitationResponseData,
} from "../../typings/server";
import type {
  CitationSource,
  Cite,
  BibliographyLine,
} from "../../typings/style";
import type { IO as CitationDialogIO } from "./citationDialog";
import { RichTextEditor } from "../components/richTextEditor";

export type IO = {
  data: BibliographyRequestData;
  resolve: (data: BibliographyResponseData | null) => void;
};

let io: IO | null = null;
let resolved = false;
let workingLine: BibliographyLine | null = null;
let extraCitation: CitationSource | undefined;

let editorEl: HTMLDivElement | null = null;
let editor: RichTextEditor | null = null;
let uncitedItemsView: _ZoteroTypes.ItemTree | null = null;

const DEFAULT_VISIBLE_COLUMNS: readonly string[] = [
  "title",
  "firstCreator",
  "date",
];

window.addEventListener("load", initBibliographyDialog);
window.addEventListener("unload", () => {
  if (!resolved) {
    io?.resolve(null);
  }
});

async function initBibliographyDialog(): Promise<void> {
  io = window.arguments[0].wrappedJSObject as IO;
  workingLine = io.data.line;
  extraCitation = io.data.extraSource;
  editorEl = document.getElementById("line-editor") as HTMLDivElement | null;
  if (editorEl) editor = new RichTextEditor(editorEl);

  renderLineEditor();
  refreshUncitedItems();

  bindButtons();
  void initUncitedItemsTree();
}

function bindButtons(): void {
  document.getElementById("accept-button")?.addEventListener("click", onAccept);
  document.getElementById("cancel-button")?.addEventListener("click", onCancel);
  document
    .getElementById("edit-uncited")
    ?.addEventListener("click", () => void onEditUncited());
}

function renderLineEditor(): void {
  if (!workingLine || !editor) return;
  editor.setUnits(workingLine.units ?? []);
}

function onAccept(): void {
  if (!io || !workingLine) return;
  if (editor) workingLine.units = editor.getUnits();
  const output: BibliographyResponseData = {
    line: workingLine,
    extraSource: extraCitation,
  };
  io.resolve(output);
  resolved = true;
  window.close();
}

function onCancel(): void {
  io?.resolve(null);
  resolved = true;
  window.close();
}

async function onEditUncited(): Promise<void> {
  if (!io) return;
  const result = await openCitationDialog(io.data);
  if (result) {
    extraCitation = result;
    refreshUncitedItems();
  }
}

function openCitationDialog(
  data: CitationRequestData,
): Promise<CitationResponseData | null> {
  return new Promise((resolve, reject) => {
    const io: CitationDialogIO = {
      data,
      mode: "uncited",
      resolve,
    };
    try {
      Services.ww.openWindow(
        // @ts-expect-error Services.ww.openWindow has incomplete type definitions
        null,
        `chrome://${addon.data.config.addonRef}/content/citationDialog.xhtml`,
        "banyan-uncited-citation-dialog",
        "chrome,modal,centerscreen",
        io,
      );
    } catch (e) {
      reject(e);
    }
  });
}

async function initUncitedItemsTree(): Promise<void> {
  const container = document.getElementById("uncited-items-tree");
  if (!container) return;
  try {
    const loader = window.require;
    const ItemTree = loader("zotero/itemTree");
    const { COLUMNS } = loader("zotero/itemTreeColumns") as {
      COLUMNS: Array<{ dataKey: string; hidden?: boolean }>;
    };
    const itemColumns = COLUMNS.map((column) => {
      const clone = { ...column };
      clone.hidden = !DEFAULT_VISIBLE_COLUMNS.includes(clone.dataKey);
      return clone;
    });

    uncitedItemsView = await ItemTree.init(container, {
      id: "banyan-uncited-items",
      dragAndDrop: false,
      columnPicker: true,
      regularOnly: true,
      multiSelect: false,
      columns: itemColumns,
    });
    await refreshUncitedItems();
  } catch (e) {
    ztoolkit.logError(e);
  }
}

async function refreshUncitedItems(): Promise<void> {
  if (!uncitedItemsView) return;
  const items = getExtraCitationItems();
  const row = makeUncitedCollectionTreeRow(items);
  try {
    await uncitedItemsView.changeCollectionTreeRow(row);
  } catch (e) {
    ztoolkit.logError(e);
  }
}

function getExtraCitationItems(): Zotero.Item[] {
  const cites: Cite[] = extraCitation?.cites ?? [];
  const ids = cites
    .map((cite) => cite.item?.id)
    .filter((id): id is number => typeof id === "number");
  const items = ids
    .map((id) => Zotero.Items.get(id))
    .filter((item): item is Zotero.Item => Boolean(item));
  return items;
}

function makeUncitedCollectionTreeRow(items: Zotero.Item[]) {
  const libraryID = Zotero.Libraries?.userLibraryID ?? 1;
  return {
    id: "banyan-uncited-items-row",
    view: {},
    ref: { libraryID },
    visibilityGroup: "",
    isSearchMode: () => true,
    isSearch: () => true,
    isLibrary: () => false,
    isCollection: () => false,
    isPublications: () => false,
    isDuplicates: () => false,
    isFeeds: () => false,
    isFeedsOrFeed: () => false,
    isTrash: () => false,
    isShare: () => false,
    getItems: async () => items,
    setSearch: () => undefined,
  };
}
