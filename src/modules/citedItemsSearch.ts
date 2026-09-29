import type {
  RefreshRequestData,
  RefreshResponseData,
} from "../../typings/server";
import type { CitationContext } from "../../typings/style";
import { useL10n } from "../utils/locale";
import {
  buildDocumentCitationPreviewMap,
  getCitationPreviewText,
  getCitedItemsSearchLabel,
  mergeDocumentCitationPreviews,
  type DocumentCitationPreview,
} from "../utils/citedItemsSearch";
import { renderRichTextToHtml } from "../utils/richTextHtml";

type CitedItemsSearchState = {
  documentId: string;
  libraryID: number | null;
  searchName: string;
  search: Zotero.Search | null;
  itemIDs: number[];
  itemData: Map<number, DocumentCitationPreview>;
};

type ExpandRow = _ZoteroTypes.CollectionTree["_expandRow"];
type GetIconName = _ZoteroTypes.CollectionTree["getIconName"];

type ZoteroPaneLike = {
  itemsView?: {
    getRow?: (index: number) => { ref?: Zotero.Item } | undefined;
    refreshAndMaintainSelection?: () => Promise<void> | void;
  };
  collectionsView?: _ZoteroTypes.CollectionTree | false;
};

const t = useL10n(["mainWindow.ftl"]);
const CITATION_PREVIEW_PART_CLASS = "banyan-document-citation-part";
// Not a built-in type, so `id` returns the preset `_id`.
const CITED_ITEMS_ROW_TYPE = "banyanCitedItems";
const CITED_ITEMS_ROW_ID_PREFIX = "banyanCited:";
// Name of Zotero's generic document glyph.
const CITED_ITEMS_ROW_ICON_NAME = "item-type";

const citedItemsSearches = new Map<string, CitedItemsSearchState>();
let registeredColumnKey: string | false | null = null;
const patchedViews = new WeakMap<
  _ZoteroTypes.CollectionTree,
  { expandRow: ExpandRow; getIconName: GetIconName }
>();

export async function registerCitationColumn(): Promise<void> {
  // Register synchronously: a duplicate registration would lose the key that
  // cleanup has to unregister.
  if (registeredColumnKey === null) {
    registeredColumnKey = Zotero.ItemTreeManager.registerColumn({
      dataKey: "citationPreview",
      label: t("item-tree-citation-column"),
      pluginID: addon.data.config.addonID,
      enabledTreeIDs: ["main"],
      flex: 2,
      minWidth: 120,
      zoteroPersist: ["width", "hidden", "sortDirection"],
      dataProvider: (item) => {
        const preview = getCitationPreview(Zotero.getMainWindow(), item.id);
        return preview ? getCitationPreviewText(preview) : "";
      },
      renderCell: (index, _data, column, _isFirstColumn, doc) => {
        const cell = doc.createElement("span");
        cell.className = `cell ${column.className} banyan-document-citation-cell`;

        const pane = getZoteroPane(doc.defaultView);
        const rowItem = pane?.itemsView?.getRow?.(index)?.ref;
        const preview = rowItem?.id
          ? getCitationPreview(doc.defaultView, rowItem.id)
          : undefined;

        if (preview) {
          cell.innerHTML = preview.htmlParts
            .map(
              (html) =>
                `<span class="${CITATION_PREVIEW_PART_CLASS}">${html}</span>`,
            )
            .join("");
          cell.title = getCitationPreviewText(preview);
        }
        return cell;
      },
    });
  }

  for (const win of Zotero.getMainWindows()) {
    patchCollectionsView(win);
  }
}

export function cleanupCitationColumn(): void {
  if (registeredColumnKey) {
    Zotero.ItemTreeManager.unregisterColumn(registeredColumnKey);
  }
  registeredColumnKey = null;

  for (const win of Zotero.getMainWindows()) {
    unpatchCollectionsView(win);
  }
  citedItemsSearches.clear();

  void refreshOpenTrees(true);
}

export function patchCollectionsView(win: Window): void {
  const view = getZoteroPane(win)?.collectionsView;
  if (!view || patchedViews.has(view)) {
    return;
  }

  const originalExpandRow = view._expandRow.bind(view);
  const originalGetIconName = view.getIconName.bind(view);
  patchedViews.set(view, {
    expandRow: originalExpandRow,
    getIconName: originalGetIconName,
  });

  view._expandRow = async (rows, row, forceOpen) => {
    const added = await originalExpandRow(rows, row, forceOpen);
    // Keep Zotero's `false` for the rows it never expands; callers sum the result.
    if (added === false) {
      return false;
    }
    return added + injectCitedItemsRows(view, rows, row, added, forceOpen);
  };

  view.getIconName = (index) =>
    view.getRow(index)?.type === CITED_ITEMS_ROW_TYPE
      ? CITED_ITEMS_ROW_ICON_NAME
      : originalGetIconName(index);
}

export function unpatchCollectionsView(win: Window): void {
  const view = getZoteroPane(win)?.collectionsView;
  if (!view) {
    return;
  }

  const original = patchedViews.get(view);
  if (original) {
    view._expandRow = original.expandRow;
    view.getIconName = original.getIconName;
    patchedViews.delete(view);
  }
}

export async function updateCitationColumnFromRefresh(
  request: Pick<RefreshRequestData, "documentId" | "contexts">,
  result: RefreshResponseData,
): Promise<void> {
  const documentId = normalizeDocumentId(request.documentId);
  const state = getOrCreateCitedItemsSearchState(documentId);
  const previousLibraryID = state.libraryID;

  state.searchName = getCitedItemsSearchLabel(documentId);
  state.libraryID = getFirstLibraryID(request.contexts) ?? state.libraryID;
  state.itemData = buildDocumentCitationPreviewMap(
    request.contexts,
    result.citations,
    (citation) =>
      renderRichTextToHtml(citation.content, { includeLinks: false }),
  );
  state.itemIDs = Array.from(state.itemData.keys());

  syncSearchForState(state);
  // A row lives under its library, so a document that moved needs the old one gone.
  await refreshOpenTrees(state.libraryID !== previousLibraryID);
}

/** Splice one row per matching document after the rows the original produced. */
function injectCitedItemsRows(
  view: _ZoteroTypes.CollectionTree,
  rows: _ZoteroTypes.CollectionTreeRow[],
  row: number,
  added: number,
  forceOpen: boolean | undefined,
): number {
  const treeRow = rows[row];
  // An on-demand expansion sets `isOpen` only after `_expandRow` returns.
  if (!treeRow.isLibrary?.(true) || (treeRow.isOpen === false && !forceOpen)) {
    return 0;
  }

  const libraryID = treeRow.ref.libraryID;
  const level = (treeRow.level ?? 0) + 1;
  let injected = 0;

  for (const state of citedItemsSearches.values()) {
    if (state.libraryID !== libraryID || !stateHasCitedItemsRow(state)) {
      continue;
    }

    const treeRowRow = new Zotero.CollectionTreeRow(
      view,
      CITED_ITEMS_ROW_TYPE,
      state.search,
      level,
      false,
    );
    treeRowRow._id = getCitedItemsRowID(state.documentId);
    rows.splice(row + 1 + added + injected, 0, treeRowRow);
    injected += 1;
  }

  return injected;
}

function stateHasCitedItemsRow(state: CitedItemsSearchState): boolean {
  return Boolean(state.search) && state.itemIDs.length > 0;
}

function getOrCreateCitedItemsSearchState(
  documentId: string,
): CitedItemsSearchState {
  const normalizedId = normalizeDocumentId(documentId);
  let state = citedItemsSearches.get(normalizedId);
  if (state) {
    return state;
  }

  state = {
    documentId: normalizedId,
    libraryID: null,
    searchName: getCitedItemsSearchLabel(normalizedId),
    search: null,
    itemIDs: [],
    itemData: new Map(),
  };
  citedItemsSearches.set(normalizedId, state);
  return state;
}

/** Rebuilds `joinMode=any` plus one `itemID is` condition per cited item. */
function syncSearchForState(state: CitedItemsSearchState): void {
  const libraryID = state.libraryID ?? Zotero.Libraries.userLibraryID;
  if (typeof libraryID !== "number") {
    return;
  }
  state.libraryID = libraryID;

  // `libraryID` is readonly, so recreate the search if the library changed.
  if (!state.search || state.search.libraryID !== libraryID) {
    state.search = new Zotero.Search({ libraryID });
  }

  const search = state.search;
  search.name = state.searchName;

  // Highest id first: removeCondition() shifts the ids after it.
  const conditionIds = Object.keys(search.getConditions())
    .map((id) => Number(id))
    .sort((a, b) => b - a);
  for (const conditionId of conditionIds) {
    search.removeCondition(conditionId);
  }

  search.addCondition("joinMode", "any");
  for (const itemID of state.itemIDs) {
    search.addCondition("itemID", "is", itemID);
  }
}

/** Id of the injected row, which `CollectionTreeRow.id` returns as is. */
function getCitedItemsRowID(documentId: string): string {
  return `${CITED_ITEMS_ROW_ID_PREFIX}${documentId}`;
}
function getCitedItemsSearchStateByRow(
  row: _ZoteroTypes.CollectionTreeRow | undefined,
): CitedItemsSearchState | null {
  if (!row || row.type !== CITED_ITEMS_ROW_TYPE) {
    return null;
  }

  const rowId = typeof row.id === "string" ? row.id : "";
  if (!rowId.startsWith(CITED_ITEMS_ROW_ID_PREFIX)) {
    return null;
  }

  const documentId = rowId.slice(CITED_ITEMS_ROW_ID_PREFIX.length);
  return citedItemsSearches.get(documentId) ?? null;
}

/** The selected document's citations for an item, or every document's. */
function getCitationPreview(
  win: Window | null | undefined,
  itemID: number,
): DocumentCitationPreview | undefined {
  const view = getZoteroPane(win)?.collectionsView;
  const state = getCitedItemsSearchStateByRow(
    view ? view.selectedTreeRow : undefined,
  );
  if (state) {
    return state.itemData.get(itemID);
  }

  const previews: DocumentCitationPreview[] = [];
  for (const candidate of citedItemsSearches.values()) {
    const preview = candidate.itemData.get(itemID);
    if (preview) {
      previews.push(preview);
    }
  }
  return previews.length ? mergeDocumentCitationPreviews(previews) : undefined;
}

function getZoteroPane(win: Window | null | undefined): ZoteroPaneLike | null {
  const pane = (win as (Window & { ZoteroPane?: ZoteroPaneLike }) | null)
    ?.ZoteroPane;
  return pane ?? null;
}

function getFirstLibraryID(contexts: CitationContext[]): number | null {
  for (const context of contexts) {
    for (const cite of context.cites) {
      if (typeof cite.item.libraryID === "number") {
        return cite.item.libraryID;
      }
    }
  }
  return null;
}

function normalizeDocumentId(documentId: string): string {
  return documentId.trim();
}

/**
 * Refresh the trees of every main window.
 *
 * @param reloadCollections - Rebuild the collections tree even if it already
 *     lists every document.
 */
async function refreshOpenTrees(reloadCollections = false): Promise<void> {
  for (const win of Zotero.getMainWindows()) {
    // A window opened after startup may not have been patched yet.
    patchCollectionsView(win);

    const pane = getZoteroPane(win);
    const view = pane?.collectionsView;
    if (view && (reloadCollections || isMissingCitedItemsRow(view))) {
      await reloadCollectionsView(view);
    }
    await pane?.itemsView?.refreshAndMaintainSelection?.();
  }
}

/** Only a row that is missing from a library the tree shows needs a rebuild. */
function isMissingCitedItemsRow(view: _ZoteroTypes.CollectionTree): boolean {
  for (const state of citedItemsSearches.values()) {
    if (!stateHasCitedItemsRow(state)) {
      continue;
    }
    if (view.getRowIndexByID(getCitedItemsRowID(state.documentId)) !== false) {
      continue;
    }
    // A collapsed library shows no children; expanding it injects them then.
    const libraryRow = view.getRowIndexByID(`L${state.libraryID}`);
    if (libraryRow !== false && view.getRow(libraryRow)?.isOpen === false) {
      continue;
    }
    return true;
  }
  return false;
}

/**
 * Reload a collections view the way Zotero's own callers do: `reload()` leaves
 * selection events suppressed, which makes the tree ignore every click, and the
 * selection has to be restored by id because row indices move.
 */
async function reloadCollectionsView(
  view: _ZoteroTypes.CollectionTree,
): Promise<void> {
  const selection = view.selection;
  const selectedID = view.getRow(selection.focused)?.id;

  await view.reload();

  if (selectedID !== undefined) {
    const index = view.getRowIndexByID(String(selectedID));
    if (index !== false) {
      selection.select(index);
    }
  }

  // Setting the flag to the value it already has fires no `select` event to await.
  if (!selection.selectEventsSuppressed) {
    return;
  }
  const selectPromise = view.waitForSelect();
  selection.selectEventsSuppressed = false;
  await selectPromise;
}
