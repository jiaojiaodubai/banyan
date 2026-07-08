import type {
  RefreshRequestData,
  RefreshResponseData,
} from "../../typings/server";
import type { CitationContext } from "../../typings/style";
import { useL10n } from "../utils/locale";
import {
  buildDocumentCitationPreviewMap,
  CITED_ITEMS_SEARCH_MARKER,
  getCitedItemsSearchLabel,
  type DocumentCitationPreview,
} from "../utils/citedItemsSearch";
import { renderRichTextToHtml } from "../utils/richTextHtml";

type CitedItemsSearchState = {
  documentId: string;
  libraryID: number | null;
  searchName: string;
  search: Zotero.Search | null;
  searchPromise?: Promise<Zotero.Search | null>;
  itemIDs: number[];
  itemData: Map<number, DocumentCitationPreview>;
};

type ZoteroPaneLike = {
  itemsView?: {
    getRow?: (index: number) => { ref?: Zotero.Item } | undefined;
    refreshAndMaintainSelection?: () => void;
  };
  collectionsView?: {
    selectedTreeRow?: _ZoteroTypes.CollectionTreeRow;
  };
};

const t = useL10n(["mainWindow.ftl"]);
const CITED_ITEMS_SEARCH_CONDITION_PREFIX = `${CITED_ITEMS_SEARCH_MARKER}:`;
const CITATION_PREVIEW_PART_CLASS = "banyan-document-citation-part";
const citedItemsSearches = new Map<string, CitedItemsSearchState>();
let registeredColumnKey: string | false | null = null;
let originalGetItems:
  | ((
      this: _ZoteroTypes.CollectionTreeRow,
      options?: { unfiltered?: boolean },
    ) => Promise<Zotero.Item[]>)
  | null = null;

export async function registerCitationColumn(): Promise<void> {
  if (registeredColumnKey === null) {
    registeredColumnKey = await Zotero.ItemTreeManager.registerColumn({
      dataKey: "citationPreview",
      label: t("item-tree-citation-column"),
      pluginID: addon.data.config.addonID,
      enabledTreeIDs: ["main"],
      flex: 2,
      minWidth: 120,
      zoteroPersist: ["width", "hidden", "sortDirection"],
      dataProvider: (item) => {
        const preview = getPreviewForSelectedCitationColumn(
          Zotero.getMainWindow(),
          item.id,
        );
        return preview ? preview.text : "";
      },
      renderCell: (index, _data, column, _isFirstColumn, doc) => {
        const cell = doc.createElement("span");
        cell.className = `cell ${column.className} banyan-document-citation-cell`;

        const pane = getZoteroPane(doc.defaultView);
        const rowItem = pane?.itemsView?.getRow?.(index)?.ref;
        const preview = rowItem?.id
          ? getPreviewForSelectedCitationColumn(doc.defaultView, rowItem.id)
          : undefined;

        if (preview) {
          cell.innerHTML = preview.htmlParts
            .map(
              (html) =>
                `<span class="${CITATION_PREVIEW_PART_CLASS}">${html}</span>`,
            )
            .join("");
          cell.title = preview.text;
        }
        return cell;
      },
    });
  }

  patchCollectionTreeRowGetItems();
  await clearOrphanCitedItemsSearches();
}

export function cleanupCitationColumn(): void {
  if (registeredColumnKey) {
    Zotero.ItemTreeManager.unregisterColumn(registeredColumnKey);
    registeredColumnKey = null;
  }

  if (originalGetItems) {
    Zotero.CollectionTreeRow.prototype.getItems = originalGetItems;
    originalGetItems = null;
  }

  for (const state of citedItemsSearches.values()) {
    if (state.search) {
      void state.search.eraseTx();
    }
  }
  citedItemsSearches.clear();
}

export async function updateCitationColumnFromRefresh(
  request: Pick<RefreshRequestData, "documentId" | "contexts">,
  result: RefreshResponseData,
): Promise<void> {
  const documentId = normalizeDocumentId(request.documentId);
  const state = getOrCreateCitedItemsSearchState(documentId);
  state.searchName = getCitedItemsSearchLabel(documentId);
  state.libraryID = getFirstLibraryID(request.contexts) ?? state.libraryID;
  state.itemData = buildDocumentCitationPreviewMap(
    request.contexts,
    result.citations,
    (citation) =>
      renderRichTextToHtml(citation.content, { includeLinks: false }),
  );
  state.itemIDs = Array.from(state.itemData.keys());

  await ensureSearchForState(state);
  refreshOpenItemTrees();
}

function patchCollectionTreeRowGetItems(): void {
  if (originalGetItems) {
    return;
  }

  originalGetItems = Zotero.CollectionTreeRow.prototype.getItems;
  Zotero.CollectionTreeRow.prototype.getItems = async function (options = {}) {
    const state = getCitedItemsSearchStateByRow(this);
    if (!state) {
      return originalGetItems!.call(this, options);
    }

    const items = await Zotero.Items.getAsync(state.itemIDs);
    const itemsByID = new Map<number, Zotero.Item>();
    for (const item of items) {
      if (typeof item.id === "number") {
        itemsByID.set(item.id, item);
      }
    }

    return state.itemIDs
      .map((itemId) => itemsByID.get(itemId))
      .filter((item): item is Zotero.Item => Boolean(item));
  };
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

function getCitedItemsSearchStateBySearchKey(
  searchKey: string | undefined,
): CitedItemsSearchState | null {
  if (!searchKey) {
    return null;
  }

  for (const state of citedItemsSearches.values()) {
    if (state.search?.key === searchKey) {
      return state;
    }
  }
  return null;
}

function getCitedItemsSearchStateBySearch(
  search: Pick<Zotero.Search, "id" | "key"> | null | undefined,
): CitedItemsSearchState | null {
  if (!search) {
    return null;
  }

  for (const state of citedItemsSearches.values()) {
    if (isSameSearch(state.search, search)) {
      return state;
    }
  }

  return getCitedItemsSearchStateBySearchKey(search.key);
}

function getCitedItemsSearchStateByRow(
  row: _ZoteroTypes.CollectionTreeRow,
): CitedItemsSearchState | null {
  if (!row.isSearch?.() || !(row.ref instanceof Zotero.Search)) {
    return null;
  }

  const mappedBySearch = getCitedItemsSearchStateBySearch(row.ref);
  if (mappedBySearch) {
    return mappedBySearch;
  }

  const documentId = getDocumentIdFromManagedSearch(row.ref);
  if (!documentId) {
    return null;
  }
  return citedItemsSearches.get(documentId) ?? null;
}

function getPreviewForSelectedCitationColumn(
  win: Window | null | undefined,
  itemID: number,
): DocumentCitationPreview | undefined {
  const row = getZoteroPane(win)?.collectionsView?.selectedTreeRow;
  const state = row ? getCitedItemsSearchStateByRow(row) : null;
  return state?.itemData.get(itemID);
}

function isSameSearch(
  left: Pick<Zotero.Search, "id" | "key"> | null | undefined,
  right: Pick<Zotero.Search, "id" | "key"> | null | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }

  return left.id === right.id || left.key === right.key;
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

async function ensureSearchForState(
  state: CitedItemsSearchState,
): Promise<Zotero.Search | null> {
  if (state.search) {
    if (state.search.name !== state.searchName) {
      state.search.name = state.searchName;
      await state.search.saveTx({ skipSelect: true });
    }
    return state.search;
  }

  if (state.searchPromise) {
    return state.searchPromise;
  }

  state.searchPromise = (async () => {
    const libraryID = state.libraryID ?? Zotero.Libraries.userLibraryID;
    if (typeof libraryID !== "number") {
      return null;
    }

    const existingSearch = await findManagedSearchByDocumentId(
      state.documentId,
      libraryID,
    );
    if (existingSearch) {
      const search = existingSearch;

      if (search.name !== state.searchName) {
        search.name = state.searchName;
        await search.saveTx({ skipSelect: true });
      }

      state.search = search;
      return search;
    }

    const search = new Zotero.Search({ libraryID });
    search.name = state.searchName;
    search.addCondition(
      "anyField",
      "contains",
      getCitedItemsSearchConditionValue(state.documentId),
    );
    await search.saveTx({ skipSelect: true });

    state.search = search;
    return search;
  })().finally(() => {
    state.searchPromise = undefined;
  });

  return state.searchPromise;
}

async function clearOrphanCitedItemsSearches(): Promise<void> {
  const activeKeys = new Set(
    Array.from(citedItemsSearches.values())
      .map((state) => state.search?.key)
      .filter((key): key is string => Boolean(key)),
  );

  for (const search of await getAllSearchesAcrossLibraries()) {
    if (!isManagedCitedItemsSearch(search) || activeKeys.has(search.key)) {
      continue;
    }
    await search.eraseTx();
  }
}

function isManagedCitedItemsSearch(search: Zotero.Search): boolean {
  return Object.values(search.getConditions()).some(
    (condition) =>
      condition.condition === "anyField" &&
      condition.operator === "contains" &&
      typeof condition.value === "string" &&
      condition.value.startsWith(CITED_ITEMS_SEARCH_CONDITION_PREFIX),
  );
}

function getCitedItemsSearchConditionValue(documentId: string): string {
  return `${CITED_ITEMS_SEARCH_CONDITION_PREFIX}${encodeURIComponent(documentId)}`;
}

async function findManagedSearchByDocumentId(
  documentId: string,
  libraryID: number,
): Promise<Zotero.Search | null> {
  const normalizedId = normalizeDocumentId(documentId);
  for (const search of await Zotero.Searches.getAll(libraryID)) {
    const searchDocumentId = getDocumentIdFromManagedSearch(search);
    if (!searchDocumentId) {
      continue;
    }

    if (normalizeDocumentId(searchDocumentId) === normalizedId) {
      return search;
    }
  }
  return null;
}

function getDocumentIdFromManagedSearch(search: Zotero.Search): string | null {
  for (const condition of Object.values(search.getConditions())) {
    if (
      condition.condition !== "anyField" ||
      condition.operator !== "contains" ||
      typeof condition.value !== "string" ||
      !condition.value.startsWith(CITED_ITEMS_SEARCH_CONDITION_PREFIX)
    ) {
      continue;
    }

    const encodedId = condition.value.slice(
      CITED_ITEMS_SEARCH_CONDITION_PREFIX.length,
    );
    if (!encodedId) {
      return null;
    }

    try {
      return decodeURIComponent(encodedId);
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeDocumentId(documentId: string): string {
  return documentId.trim();
}

function refreshOpenItemTrees(): void {
  for (const win of Zotero.getMainWindows()) {
    const pane = getZoteroPane(win);
    pane?.itemsView?.refreshAndMaintainSelection?.();
  }
}

async function getAllSearchesAcrossLibraries(): Promise<Zotero.Search[]> {
  const searches: Zotero.Search[] = [];
  for (const library of Zotero.Libraries.getAll()) {
    searches.push(...(await Zotero.Searches.getAll(library.libraryID)));
  }
  return searches;
}
