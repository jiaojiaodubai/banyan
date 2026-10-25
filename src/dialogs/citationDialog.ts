import type {
  CitationDialogRequestData,
  CitationResponseData,
} from "../../typings/server";
import type {
  CitationContext,
  CitationParam,
  CitationParams,
  Cite,
  ParamDeclarations,
  StyleOptionValues,
} from "@banyan/core/types/style";
import {
  resolveCitationParamValues,
  resolveStyleOptionState,
  type ParamState,
} from "@banyan/core/validation/paramValues";
import { BubbleInput } from "../ui/bubbleInput";
import {
  ParameterPanel,
  initialParameterValue,
  type ScalarValue,
} from "../ui/parameterPanel";
import { getStyleOptionState } from "../modules/styles";
import { getZoteroItemId, toBanyanItem } from "../modules/sandbox/items";
import { useL10n } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import { unwrapDialogIO } from "../utils/window";
import { createLogger } from "../utils/logger";

const log = createLogger("citation-dialog");

export type IO = {
  data: CitationDialogRequestData;
  mode?: "default" | "uncited";
  resolve: (citation: CitationResponseData) => void;
};

type ItemTreeColumn = {
  dataKey: string;
  hidden?: boolean;
  [key: string]: unknown;
};

const SIDEBAR_MIN = 120;
const SIDEBAR_MAX_RATIO = 0.5;
const DEFAULT_VISIBLE_COLUMNS: readonly string[] = [
  "title",
  "firstCreator",
  "date",
];
const SEARCH_TIMEOUT = 250;
const ITEMTREE_FILTER_ID = "citation-search";

const LIBRARY_MIN_HEIGHT = 200;
const MIN_HEIGHT_UPDATE_DEBOUNCE = 60;
const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

const t = useL10n(["citationDialog.ftl"]);

const CITATION_DIALOG_INITIAL_COLLECTION_MODE_PREF =
  "citationDialogInitialCollectionMode" as const;
const CITATION_DIALOG_LAST_SELECTED_COLLECTION_PREF =
  "integration.citationDialogCollectionLastSelected";
const CITATION_DIALOG_COLLECTION_TREE_WIDTH_PREF =
  "citationDialogCollectionTreeWidth" as const;
type CitationDialogInitialCollectionMode =
  "mainLibrary" | "followAppSelection" | "lastSelected";

type ResolvedCitation = ReturnType<typeof resolveCitationParamValues>;

let io: IO | null = null;
let resolved = false;
let collectionsView: _ZoteroTypes.CollectionTree | null = null;
let itemsView: _ZoteroTypes.CollectionViewItemTree | null = null;
let acceptButton: HTMLButtonElement | null = null;
let bubbleInput: BubbleInput | null = null;

// Store current values for citation-scope options
let citationParams: CitationParams = {};
/** Effective document-wide option values, read by control predicates. */
let styleOptions: StyleOptionValues = {};
let citationPanel: ParameterPanel<CitationParam> | null = null;
let citationDeclarations: CitationParam[] = [];
/**
 * One resolution per change. `ParameterPanel.refresh()` asks for each control's
 * state separately, and cite predicates read the resolved citation again, so
 * resolving per call would run every `applicable`/`validate` callback N times.
 */
let citationResolution: ResolvedCitation | null = null;

let committedItemIDs = new Set<number>();

let searchDebounceTimer: number | null = null;
let lastSearchQuery = "";

let itemsTreeSpaceCaptureAttached = false;

let itemsTreeContextMenu: XUL.MenuPopup | null = null;
let itemsTreeCommitSelectedMenuItem: XUL.MenuItem | null = null;
let itemsTreeUncommitSelectedMenuItem: XUL.MenuItem | null = null;

let minHeightUpdateTimer: number | null = null;
let windowResizeHandler: (() => void) | null = null;
let headerResizeObserver: ResizeObserver | null = null;
let footerResizeObserver: ResizeObserver | null = null;

function getItemsViewCollectionTreeRows(): _ZoteroTypes.CollectionTreeRow[] {
  return itemsView?.collectionTreeRows ?? [];
}

function getItemsViewPrimaryCollectionTreeRow(): _ZoteroTypes.CollectionTreeRow | null {
  return getItemsViewCollectionTreeRows()[0] ?? null;
}

function getSelectedCollectionTreeRows(): _ZoteroTypes.CollectionTreeRow[] {
  if (!collectionsView?.selection.count) return [];

  const selected = collectionsView.selection.selected;
  if (selected?.size) {
    return Array.from(selected)
      .sort((a, b) => a - b)
      .map((index) => collectionsView!.getRow(index))
      .filter(Boolean);
  }

  return [collectionsView.getRow(collectionsView.selection.focused)].filter(
    Boolean,
  );
}

function getSortedCollectionTreeRowIDs(
  collectionTreeRows: _ZoteroTypes.CollectionTreeRow[],
): string[] {
  return collectionTreeRows.map((row) => String(row.id)).sort();
}

function areCollectionTreeRowSelectionsEqual(
  a: _ZoteroTypes.CollectionTreeRow[],
  b: _ZoteroTypes.CollectionTreeRow[],
): boolean {
  if (a.length !== b.length) return false;

  const aIDs = getSortedCollectionTreeRowIDs(a);
  const bIDs = getSortedCollectionTreeRowIDs(b);
  return aIDs.every((id, index) => id === bIDs[index]);
}

async function waitForCollectionTreeRowLibraries(
  collectionTreeRows: _ZoteroTypes.CollectionTreeRow[],
): Promise<boolean> {
  const loadPromises: Array<Promise<void>> = [];

  for (const libraryID of new Set(
    collectionTreeRows.map((row) => row.ref.libraryID),
  )) {
    const library = Zotero.Libraries.get(libraryID);
    if (!library) return false;

    if (!library.getDataLoaded("item")) {
      loadPromises.push(library.waitForDataLoad("item"));
    }
  }

  await Promise.all(loadPromises);

  return true;
}

function getItemsViewFocusedRowIndex(): number {
  const focused = itemsView?.tree?.selection?.focused;
  if (typeof focused === "number") return focused;

  // The virtualized tree is not ready during the first render; the item view
  // still exposes its selection then.
  const fallbackFocused = itemsView?.selection?.focused;
  return typeof fallbackFocused === "number" ? fallbackFocused : -1;
}

window.addEventListener("load", initCitationDialog);
window.addEventListener("unload", () => {
  if (!resolved) {
    io?.resolve(null);
  }
  // Nothing in the dialog may keep running after it closes: pending timers and
  // observers would touch the dead document, and the trees must unregister
  // their notifier observers (see `unregister()` on the Zotero trees).
  if (searchDebounceTimer !== null) {
    window.clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
  if (minHeightUpdateTimer !== null) {
    window.clearTimeout(minHeightUpdateTimer);
    minHeightUpdateTimer = null;
  }
  if (windowResizeHandler) {
    window.removeEventListener("resize", windowResizeHandler);
    windowResizeHandler = null;
  }
  headerResizeObserver?.disconnect();
  headerResizeObserver = null;
  footerResizeObserver?.disconnect();
  footerResizeObserver = null;
  itemsView?.unregister();
  collectionsView?.unregister();
});

async function initCitationDialog(): Promise<void> {
  try {
    io = unwrapDialogIO<IO>(window.arguments?.[0]);
    if (!io) {
      throw new Error("citationDialog: window IO is missing");
    }
    if (io?.mode === "uncited") {
      document.title = t("citation-dialog-uncited-title");
    }
    const declarations = await resolveParamDeclarations(io.data.style);
    citationDeclarations = declarations.citation ?? [];

    citationParams = { ...(io?.data.source?.params ?? {}) };
    styleOptions = await resolveDialogStyleOptions(
      io?.data.style,
      io?.data.options,
    );

    for (const control of citationDeclarations) {
      citationParams[control.id] = initialParameterValue(
        control,
        io?.data.source?.params?.[control.id],
      );
    }

    // Seed committed set so opening an existing citation doesn't log as add/remove
    committedItemIDs = new Set<number>();
    for (const cite of io?.data.source?.cites ?? []) {
      const id = getCiteItemID(cite);
      if (id != null) committedItemIDs.add(id);
    }

    acceptButton = document.getElementById(
      "accept-button",
    ) as HTMLButtonElement | null;

    const searchContainer = document.getElementById("search-placeholder");
    if (searchContainer) {
      const citeControls = declarations.cite || [];
      bubbleInput = new BubbleInput(
        searchContainer as HTMLElement,
        citeControls,
        {
          onSearch: (query) => {
            void scheduleApplyItemsFilter(query);
          },
          onConfirm: () => {
            void handleSearchEnter();
          },
          onCitesChanged: (cites) => {
            logCitesDelta(cites);
            invalidateCitationResolution();
            citationPanel?.refresh();
            scheduleAcceptUpdate();
            refreshItemsHighlight();
          },
          onDropItemIDs: (itemIDs, insertIndex) => {
            addDraggedItemsToCitation(itemIDs, insertIndex);
          },
        },
        {
          getCitationParams: () => resolvedCitationContext().params,
          getStyleOptions: () => styleOptions,
        },
      );
    }

    bindButtons();
    bindShortcut();

    initResizableSidebar();
    await initLibrary();
    await selectInitialCollection();

    // Restore initial cites first: citation controls may ask about them
    // (visibility predicates see the cites being edited).
    if (io?.data.source?.cites?.length && bubbleInput) {
      bubbleInput.setCites(io.data.source.cites, { notify: true });
    }
    renderCitationOptions(citationDeclarations);
    initDynamicDialogMinHeight();
    refreshItemsHighlight();

    updateAcceptButton();
  } catch (e) {
    log.error("初始化引用对话框失败", e);
    if (!resolved) {
      io?.resolve(null);
      resolved = true;
    }
    window.close();
  }
}

function isStyleIdentifier(
  styleInput: CitationDialogRequestData["style"],
): styleInput is { id: string; title: string } {
  return (
    !!styleInput &&
    typeof styleInput === "object" &&
    "id" in styleInput &&
    "title" in styleInput &&
    typeof styleInput.id === "string" &&
    typeof styleInput.title === "string"
  );
}

async function resolveParamDeclarations(
  styleInput: CitationDialogRequestData["style"],
): Promise<ParamDeclarations> {
  if (isStyleIdentifier(styleInput)) {
    return addon.api.getParamDeclarations(styleInput);
  }

  return {
    style: Array.isArray(styleInput.style) ? styleInput.style : [],
    cite: Array.isArray(styleInput.cite) ? styleInput.cite : [],
    citation: Array.isArray(styleInput.citation) ? styleInput.citation : [],
  };
}

/**
 * Effective style options for control predicates. The request carries stored
 * values; the core resolves defaults and forced values, exactly like the
 * refresh path does for `generate()`.
 */
async function resolveDialogStyleOptions(
  styleInput: CitationDialogRequestData["style"],
  stored: StyleOptionValues | undefined,
): Promise<StyleOptionValues> {
  if (!isStyleIdentifier(styleInput)) {
    // Param declarations carry the style-option schema itself, so the dialog
    // resolves them the same way it would for a style binding.
    try {
      return resolveStyleOptionState(styleInput.style, stored).effectiveValues;
    } catch (e) {
      log.error("解析样式全局选项失败", e);
      return stored ? { ...stored } : {};
    }
  }
  // Style bindings carry the saved options inside `style`; WPS/Word use that
  // shape, while the plugin's own callers may send a top-level `options`.
  const styleStored =
    stored ?? (styleInput as { options?: StyleOptionValues }).options;
  try {
    const { state } = await getStyleOptionState(styleInput, styleStored);
    return state.effectiveValues;
  } catch (e) {
    log.error("读取样式全局选项失败", e);
    return styleStored ? { ...styleStored } : {};
  }
}

async function initLibrary(): Promise<void> {
  try {
    const loader = window.require;
    const CollectionTree = loader("zotero/collectionTree");
    const CollectionViewItemTree = loader("zotero/collectionViewItemTree");
    const { COLUMNS } = loader("zotero/itemTreeColumns") as {
      COLUMNS: ItemTreeColumn[];
    };
    const itemColumns: ItemTreeColumn[] = COLUMNS.map((column) => {
      const clone = { ...column };
      clone.hidden = !DEFAULT_VISIBLE_COLUMNS.includes(clone.dataKey);
      return clone;
    });

    // CollectionTree selects its initial row while loading, so ItemTree must
    // already exist when the resulting selection callback runs.
    itemsView = await CollectionViewItemTree.init(
      document.getElementById("zotero-items-tree"),
      {
        id: "citationDialog",
        dragAndDrop: true,
        columnPicker: true,
        regularOnly: true,
        multiSelect: true,
        onContextMenu: (event: MouseEvent, x: number, y: number) => {
          showItemsTreeContextMenu(event, x, y);
        },
        onActivate: (_event: Event, items?: Zotero.Item[]) => {
          void onItemsActivated(items);
        },
        columns: itemColumns,
      },
    );

    const initializedCollectionsView = await CollectionTree.init(
      document.getElementById("zotero-collections-tree"),
      {
        onSelectionChange: handleLibraryCollectionSelection,
        hideSources: ["duplicates", "trash", "feeds"],
        multiSelect: true,
      },
    );
    collectionsView = initializedCollectionsView;
    initializedCollectionsView.itemTreeView = itemsView;
    await new Promise<void>((resolve) => {
      initializedCollectionsView.onLoad.addListener(resolve);
    });

    bindItemsTreeSpaceToggle();
  } catch (e) {
    log.error("初始化文库视图失败", e);
  }
}

async function selectInitialCollection(): Promise<void> {
  if (!collectionsView) return;

  const mode = getPref(
    CITATION_DIALOG_INITIAL_COLLECTION_MODE_PREF,
  ) as CitationDialogInitialCollectionMode;
  if (mode === "followAppSelection") {
    const restored = await restoreAppSelectedCollection();
    if (restored) return;
  }

  if (mode === "lastSelected") {
    const restored = await restoreLastSelectedCollection();
    if (restored) return;
  }

  await selectMainLibraryByDefault();
}

async function selectMainLibraryByDefault(): Promise<void> {
  if (!collectionsView) return;

  const userLibraryID = Zotero.Libraries?.userLibraryID;
  if (typeof userLibraryID !== "number") return;

  try {
    await collectionsView.selectLibrary(userLibraryID);
  } catch (e) {
    log.error("默认选中主文库失败", e);
  }
}

async function restoreLastSelectedCollection(): Promise<boolean> {
  if (!collectionsView) return false;

  const lastSelected = Zotero.Prefs.get(
    CITATION_DIALOG_LAST_SELECTED_COLLECTION_PREF,
  ) as string | undefined;
  if (!lastSelected) return false;

  try {
    const restored = await collectionsView.selectByID?.(lastSelected);
    return restored !== false;
  } catch (e) {
    log.error("恢复上次选中的分类失败", e);
    return false;
  }
}

async function restoreAppSelectedCollection(): Promise<boolean> {
  if (!collectionsView) return false;

  const mainWindow = Zotero.getMainWindow();
  const zoteroPane = mainWindow?.ZoteroPane;
  const activeCollectionsView = zoteroPane?.collectionsView;
  if (!activeCollectionsView) return false;

  const selectedTreeRow = activeCollectionsView.selectedTreeRow;
  if (!selectedTreeRow) return false;

  const supportsRestoreTarget =
    selectedTreeRow.isLibrary?.() || selectedTreeRow.isCollection?.();
  if (!supportsRestoreTarget) return false;

  const targetID = selectedTreeRow.id;
  if (typeof targetID !== "string") return false;

  const selectedItemIDs = zoteroPane.getSelectedItems?.(true, {
    libraryTabOnly: true,
  });

  try {
    const restored = await collectionsView.selectByID?.(targetID);
    if (restored === false) return false;

    if (selectedItemIDs?.length) {
      await itemsView?.selectItems(selectedItemIDs);
    }
    return true;
  } catch (e) {
    log.error("恢复客户端当前选中的分类失败", e);
    return false;
  }
}

function saveLastSelectedCollection(): void {
  const selectedTreeRow = collectionsView?.selectedTreeRow;
  const id = selectedTreeRow?.id;
  if (typeof id !== "string") return;
  Zotero.Prefs.set(CITATION_DIALOG_LAST_SELECTED_COLLECTION_PREF, id);
}

function bindButtons(): void {
  acceptButton?.addEventListener("click", onAccept);
  document.getElementById("cancel-button")?.addEventListener("click", () => {
    io?.resolve(null);
    resolved = true;
    window.close();
  });
}

function bindShortcut(): void {
  document.addEventListener("keydown", onKeydown);
}

function bindItemsTreeSpaceToggle(): void {
  if (itemsTreeSpaceCaptureAttached) return;
  if (!itemsView) return;

  const treeEl = document.getElementById(
    "zotero-items-tree",
  ) as HTMLElement | null;
  if (!treeEl) return;

  treeEl.addEventListener(
    "keydown",
    (e: KeyboardEvent) => {
      if (!itemsView || !bubbleInput) return;
      if (!(e.key === " " || e.code === "Space" || e.key === "Spacebar"))
        return;

      // Stop Zotero default behavior (toggle candidate selection) in this dialog.
      e.preventDefault();
      e.stopImmediatePropagation?.();
      e.stopPropagation();

      toggleSelectedItemsCommitState({ fallbackToFocusedItem: true });
    },
    true,
  );

  itemsTreeSpaceCaptureAttached = true;
}

function onKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    onAccept();
    return;
  }
  if (event.key === "Escape") {
    bubbleInput?.clearSearch();
    return;
  }
}

async function onItemsActivated(activatedItems?: Zotero.Item[]) {
  toggleSelectedItemsCommitState({
    explicitItems: activatedItems,
    fallbackToFocusedItem: true,
  });
  window.setTimeout(() => {
    bubbleInput?.focus();
  }, 5);
}

function getItemsTreeSelection(options?: {
  explicitItems?: Zotero.Item[];
  fallbackToFocusedItem?: boolean;
}): Zotero.Item[] {
  const explicitItems = options?.explicitItems?.filter(Boolean) ?? [];
  if (explicitItems.length) {
    return explicitItems;
  }

  if (!itemsView) return [];
  const selectedItems = itemsView.getSelectedItems?.() ?? [];
  if (selectedItems.length > 0 || !options?.fallbackToFocusedItem) {
    return selectedItems;
  }

  const focused = getItemsViewFocusedRowIndex();
  if (typeof focused !== "number" || focused < 0) {
    return [];
  }

  const row = itemsView.getRow?.(focused);
  const focusedItem = row?.ref as Zotero.Item | undefined;
  return focusedItem ? [focusedItem] : [];
}

function addDraggedItemsToCitation(
  itemIDs: number[],
  insertIndex: number,
): void {
  if (!bubbleInput || !itemIDs.length) return;

  const items = itemIDs
    .map((itemID) => Zotero.Items.get(itemID))
    .filter((item): item is Zotero.Item => Boolean(item));
  if (!items.length) return;

  const existingByID = new Set<number>();
  for (const cite of bubbleInput.Cites) {
    const id = getCiteItemID(cite);
    if (id != null) {
      existingByID.add(id);
    }
  }

  let offset = 0;
  for (const item of items) {
    const cite = makeCiteFromZoteroItem(item);
    const id = getCiteItemID(cite);
    if (id == null || existingByID.has(id)) {
      continue;
    }

    bubbleInput.addCite(cite, {
      index: insertIndex + offset,
      preserveSearch: true,
      focusAfter: false,
    });
    existingByID.add(id);
    offset++;
  }
}

function toggleSelectedItemsCommitState(options?: {
  explicitItems?: Zotero.Item[];
  fallbackToFocusedItem?: boolean;
}): void {
  if (!itemsView || !bubbleInput) return;

  const targets = getItemsTreeSelection(options);
  if (!targets.length) return;

  const existingByID = new Map<number, Cite>();
  for (const c of bubbleInput.Cites) {
    const id = getCiteItemID(c);
    if (id != null) existingByID.set(id, c);
  }

  const normalizedTargets: Array<{ id: number; cite: Cite }> = [];
  for (const item of targets) {
    const simplified = toBanyanItem(item);
    const id = getZoteroItemId(simplified);
    if (id == null) continue;
    normalizedTargets.push({ id, cite: { item: simplified, params: {} } });
  }
  if (!normalizedTargets.length) return;

  const toRemove: Cite[] = [];
  const toAdd: Cite[] = [];
  for (const { id, cite } of normalizedTargets) {
    const existing = existingByID.get(id);
    if (existing) {
      toRemove.push(existing);
    } else {
      toAdd.push(cite);
    }
  }

  for (const cite of toRemove) {
    bubbleInput.removeCite(cite);
  }

  const insertIndex = bubbleInput.getFutureBubbleIndex();
  let offset = 0;
  for (const cite of toAdd) {
    bubbleInput.addCite(cite, {
      index: insertIndex + offset,
      preserveSearch: true,
      focusAfter: false,
    });
    offset++;
  }
}

async function handleLibraryCollectionSelection(): Promise<void> {
  saveLastSelectedCollection();
  if (!collectionsView?.selection.count || !itemsView) {
    return;
  }
  const selectedRows = getSelectedCollectionTreeRows();
  if (!selectedRows.length) return;

  const currentCollectionTreeRows = getItemsViewCollectionTreeRows();
  if (
    areCollectionTreeRowSelectionsEqual(currentCollectionTreeRows, selectedRows)
  ) {
    return;
  }

  const librariesLoaded = await waitForCollectionTreeRowLibraries(selectedRows);
  if (!librariesLoaded) return;

  await itemsView.changeCollectionTreeRows(
    selectedRows.map((collectionTreeRow) => ({
      id: collectionTreeRow.id,
      getItems: async () => {
        return await collectionTreeRow.getItems();
      },
      // Required for ItemTree.setFilter('search' | 'citation-search')
      // ItemTree will call this.collectionTreeRow.setSearch(...)
      isSearch: () => true,
      isSearchMode: () => true,
      setSearch: (searchText: string, mode?: string) =>
        collectionTreeRow.setSearch?.(searchText, mode),
      clearCache: () => collectionTreeRow.clearCache?.(),
      ref: collectionTreeRow.ref,
    })),
  );

  // Re-apply active filter after switching collections
  await applyItemsFilter(bubbleInput?.SearchText ?? lastSearchQuery);
}

function onAccept(): void {
  if (!io || !bubbleInput) return;
  if (!validateBeforeAccept()) return;

  const output: CitationResponseData = {
    cites: bubbleInput.Cites,
    params: citationParams,
  };
  log.debug("output", output);
  io.resolve(output);
  resolved = true;
  window.close();
}

/**
 * Validation gate for the whole dialog: citation-scope errors are already on
 * screen; cite params may live in a closed popup, so they are re-checked from
 * the stored values before the result is accepted.
 */
function validateBeforeAccept(): boolean {
  const citationValid = citationPanel?.isValid() ?? true;
  if (!citationValid) {
    citationPanel?.focusFirstInvalid();
    return false;
  }
  if (!(bubbleInput?.validateAll() ?? true)) {
    bubbleInput?.focusFirstInvalid();
    return false;
  }
  return true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function elideMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return "…";
  const left = Math.ceil((maxChars - 1) / 2);
  const right = Math.floor((maxChars - 1) / 2);
  return `${text.slice(0, left)}…${text.slice(text.length - right)}`;
}

function getCiteItemID(cite: Cite): number | null {
  return getZoteroItemId(cite.item) ?? null;
}

function getCiteTitleForLog(cite: Cite): string {
  try {
    const title = String(cite.item.title ?? "");
    return title ? elideMiddle(title, 80) : "";
  } catch {
    return "";
  }
}

function logCitesDelta(nextCites: Cite[]): void {
  const nextIDs = new Set<number>();
  const byID = new Map<number, Cite>();
  for (const cite of nextCites) {
    const id = getCiteItemID(cite);
    if (id == null) continue;
    nextIDs.add(id);
    if (!byID.has(id)) byID.set(id, cite);
  }

  const added: number[] = [];
  const removed: number[] = [];
  for (const id of nextIDs) {
    if (!committedItemIDs.has(id)) added.push(id);
  }
  for (const id of committedItemIDs) {
    if (!nextIDs.has(id)) removed.push(id);
  }

  for (const id of added) {
    const cite = byID.get(id);
    const title = cite ? getCiteTitleForLog(cite) : "";
    log.debug(`commit+ ${id}${title ? ` ${title}` : ""}`);
  }
  for (const id of removed) {
    log.debug(`commit- ${id}`);
  }

  committedItemIDs = nextIDs;
}

function makeCiteFromZoteroItem(item: Zotero.Item): Cite {
  return { item: toBanyanItem(item), params: {} };
}

function createXULElementCompat(tag: string): Element {
  const xulDocument = document as Document & {
    createXULElement?: (name: string) => Element;
  };
  if (typeof xulDocument.createXULElement === "function") {
    return xulDocument.createXULElement(tag);
  }
  return document.createElementNS(XUL_NS, tag);
}

function ensureItemsTreeContextMenu(): void {
  if (itemsTreeContextMenu) return;

  let popupset = document.querySelector("popupset") as Element | null;
  if (!popupset) {
    popupset = createXULElementCompat("popupset");
    popupset.setAttribute("id", "banyan-citation-popupset");
    const root = document.documentElement ?? document.body;
    root?.appendChild(popupset);
  }

  const menupopup = createXULElementCompat("menupopup") as XUL.MenuPopup;
  menupopup.setAttribute("id", "banyan-citation-items-tree-context");

  const commit = createXULElementCompat("menuitem") as XUL.MenuItem;
  commit.setAttribute("id", "banyan-citation-items-tree-commit-selected");
  commit.setAttribute("label", t("citation-dialog-itemtree-commit-selected"));
  commit.addEventListener("command", () => {
    commitSelectedItemsFromContextMenu();
  });

  const uncommit = createXULElementCompat("menuitem") as XUL.MenuItem;
  uncommit.setAttribute("id", "banyan-citation-items-tree-uncommit-selected");
  uncommit.setAttribute(
    "label",
    t("citation-dialog-itemtree-uncommit-selected"),
  );
  uncommit.addEventListener("command", () => {
    uncommitSelectedItemsFromContextMenu();
  });

  menupopup.appendChild(commit);
  menupopup.appendChild(uncommit);
  popupset.appendChild(menupopup);

  itemsTreeContextMenu = menupopup;
  itemsTreeCommitSelectedMenuItem = commit;
  itemsTreeUncommitSelectedMenuItem = uncommit;
}

function updateItemsTreeContextMenuState(): void {
  if (!itemsView || !bubbleInput) return;
  if (!itemsTreeCommitSelectedMenuItem || !itemsTreeUncommitSelectedMenuItem)
    return;

  const selectedItems = itemsView.getSelectedItems?.() ?? [];
  if (!selectedItems.length) {
    itemsTreeCommitSelectedMenuItem.disabled = true;
    itemsTreeUncommitSelectedMenuItem.disabled = true;
    return;
  }

  const existingByID = new Map<number, Cite>();
  for (const c of bubbleInput.Cites) {
    const id = getCiteItemID(c);
    if (id != null && !existingByID.has(id)) {
      existingByID.set(id, c);
    }
  }

  let hasToCommit = false;
  let hasToUncommit = false;
  for (const item of selectedItems) {
    const simplified = toBanyanItem(item);
    const id = getZoteroItemId(simplified);
    if (id == null) continue;
    if (existingByID.has(id)) {
      hasToUncommit = true;
    } else {
      hasToCommit = true;
    }
    if (hasToCommit && hasToUncommit) break;
  }

  itemsTreeCommitSelectedMenuItem.disabled = !hasToCommit;
  itemsTreeUncommitSelectedMenuItem.disabled = !hasToUncommit;
}

function commitSelectedItemsFromContextMenu(): void {
  if (!itemsView || !bubbleInput) return;

  const selectedItems = itemsView.getSelectedItems?.() ?? [];
  if (!selectedItems.length) return;

  const existingByID = new Map<number, Cite>();
  for (const c of bubbleInput.Cites) {
    const id = getCiteItemID(c);
    if (id != null && !existingByID.has(id)) {
      existingByID.set(id, c);
    }
  }

  const insertIndex = bubbleInput.getFutureBubbleIndex();
  let offset = 0;
  for (const item of selectedItems) {
    const cite = makeCiteFromZoteroItem(item);
    const id = getCiteItemID(cite);
    if (id == null) continue;
    if (existingByID.has(id)) continue;
    bubbleInput.addCite(cite, {
      index: insertIndex + offset,
      preserveSearch: true,
      focusAfter: false,
    });
    offset++;
  }
}

function uncommitSelectedItemsFromContextMenu(): void {
  if (!itemsView || !bubbleInput) return;

  const selectedItems = itemsView.getSelectedItems?.() ?? [];
  if (!selectedItems.length) return;

  const existingByID = new Map<number, Cite>();
  for (const c of bubbleInput.Cites) {
    const id = getCiteItemID(c);
    if (id != null && !existingByID.has(id)) {
      existingByID.set(id, c);
    }
  }

  for (const item of selectedItems) {
    const simplified = toBanyanItem(item);
    const id = getZoteroItemId(simplified);
    if (id == null) continue;
    const existing = existingByID.get(id);
    if (existing) {
      bubbleInput.removeCite(existing);
    }
  }
}

function showItemsTreeContextMenu(
  _event: MouseEvent,
  screenX: number,
  screenY: number,
): void {
  if (!itemsView || !bubbleInput) return;

  const selectedItems = itemsView.getSelectedItems?.() ?? [];
  if (!selectedItems.length) return;

  ensureItemsTreeContextMenu();
  if (!itemsTreeContextMenu) return;

  updateItemsTreeContextMenuState();

  (
    itemsTreeContextMenu as XUL.MenuPopup & {
      openPopupAtScreen?: (
        x: number,
        y: number,
        isContextMenu: boolean,
      ) => void;
    }
  ).openPopupAtScreen?.(screenX, screenY, true);
}

async function ensureItemsViewReady(): Promise<_ZoteroTypes.CollectionViewItemTree | null> {
  if (!itemsView) return null;
  // Avoid errors when setting filter before initial collection row is set
  const deadline = Date.now() + 2000;
  while (!getItemsViewPrimaryCollectionTreeRow()) {
    if (Date.now() > deadline) return itemsView;
    await delay(10);
  }
  return itemsView;
}

async function applyItemsFilter(query: string): Promise<void> {
  lastSearchQuery = query;
  const view = await ensureItemsViewReady();
  if (!view) return;
  try {
    await view.setFilter(ITEMTREE_FILTER_ID, query);
  } catch (e) {
    log.error("设置条目过滤失败", e);
  }
}

async function scheduleApplyItemsFilter(query: string): Promise<void> {
  if (searchDebounceTimer) {
    window.clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
  // Apply quickly but avoid spamming setFilter for every keystroke
  searchDebounceTimer = window.setTimeout(() => {
    searchDebounceTimer = null;
    void applyItemsFilter(query);
  }, SEARCH_TIMEOUT);
}

async function handleSearchEnter(): Promise<void> {
  // Priority: if Enter can "commit" one or more items, do that.
  // Otherwise, treat Enter as Accept when user is focused in the search box.
  const committed = await confirmFromSearch();
  if (committed) {
    return;
  }
  if (bubbleInput && bubbleInput.Cites.length > 0) {
    onAccept();
  }
}

async function confirmFromSearch(): Promise<boolean> {
  if (!itemsView || !bubbleInput) return false;

  const beforeCount = bubbleInput.Cites.length;

  const insertIndex = bubbleInput.getFutureBubbleIndex();

  // If user has selected rows in the tree, add those.
  const selectedItems = itemsView.getSelectedItems();
  if (selectedItems?.length) {
    let offset = 0;
    for (const item of selectedItems) {
      bubbleInput.addCite(makeCiteFromZoteroItem(item), {
        index: insertIndex + offset,
      });
      offset++;
    }
    return bubbleInput.Cites.length > beforeCount;
  }

  // Otherwise, if there is an active search, add the first visible row.
  const query = bubbleInput.SearchText.trim();
  const rowCount = itemsView.rowCount;
  if (query && rowCount && rowCount > 0) {
    const firstRow = itemsView.getRow(0);
    const firstItem = firstRow?.ref;
    if (firstItem) {
      bubbleInput.addCite(makeCiteFromZoteroItem(firstItem), {
        index: insertIndex,
      });
    }
  }

  return bubbleInput.Cites.length > beforeCount;
}

function initDynamicDialogMinHeight(): void {
  scheduleUpdateDialogMinHeight();

  windowResizeHandler = () => {
    scheduleUpdateDialogMinHeight();
  };
  window.addEventListener("resize", windowResizeHandler);

  if (typeof ResizeObserver === "undefined") {
    return;
  }

  const header = document.querySelector("header") as HTMLElement | null;
  const footer = document.querySelector("footer") as HTMLElement | null;

  // Header height is dynamic (bubble input can wrap), so observe it too.
  if (header) {
    headerResizeObserver?.disconnect();
    headerResizeObserver = new ResizeObserver(() => {
      scheduleUpdateDialogMinHeight();
    });
    headerResizeObserver.observe(header);
  }

  if (footer) {
    footerResizeObserver?.disconnect();
    footerResizeObserver = new ResizeObserver(() => {
      scheduleUpdateDialogMinHeight();
    });
    footerResizeObserver.observe(footer);
  }
}

function scheduleUpdateDialogMinHeight(): void {
  if (minHeightUpdateTimer) {
    window.clearTimeout(minHeightUpdateTimer);
    minHeightUpdateTimer = null;
  }
  minHeightUpdateTimer = window.setTimeout(() => {
    minHeightUpdateTimer = null;
    updateDialogMinHeight();
  }, MIN_HEIGHT_UPDATE_DEBOUNCE);
}

function updateDialogMinHeight(): void {
  const header = document.querySelector("header") as HTMLElement | null;
  const footer = document.querySelector("footer") as HTMLElement | null;

  const headerH = header ? header.getBoundingClientRect().height : 0;
  const footerH = footer ? footer.getBoundingClientRect().height : 0;

  // Safety padding to avoid fractional rounding causing 1px overflow.
  const minHeight = Math.ceil(headerH + footerH + LIBRARY_MIN_HEIGHT + 2);
  const root = (document.documentElement ?? null) as HTMLElement | null;
  if (!root) return;
  root.style.minHeight = `${minHeight}px`;
}

function initResizableSidebar(): void {
  const dialogRoot = document.documentElement;
  const libraryTrees = document.getElementById(
    "library-trees",
  ) as HTMLElement | null;
  const sidebar = document.getElementById(
    "collections-tree-container",
  ) as HTMLElement | null;
  const splitter = document.getElementById(
    "tree-pane-splitter",
  ) as HTMLElement | null;
  if (!sidebar || !splitter || !libraryTrees) {
    return;
  }

  const applyWidth = (width: number) => {
    const containerWidth = libraryTrees.getBoundingClientRect().width;
    const maxWidth = containerWidth * SIDEBAR_MAX_RATIO;
    const clamped = Math.max(SIDEBAR_MIN, Math.min(maxWidth, width));

    sidebar.style.setProperty("--sidebar-width", `${clamped}px`);
    sidebar.style.flexBasis = `${clamped}px`;
    sidebar.style.width = `${clamped}px`;
    return clamped;
  };

  let currentWidth = applyWidth(
    getPref(CITATION_DIALOG_COLLECTION_TREE_WIDTH_PREF) || SIDEBAR_MIN + 50,
  );

  splitter.addEventListener("pointerdown", (event: PointerEvent) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = sidebar.getBoundingClientRect().width;

    splitter.setPointerCapture(event.pointerId);
    splitter.classList.add("is-dragging");
    dialogRoot?.classList.add("is-resizing");

    const onPointerMove = (e: PointerEvent) => {
      currentWidth = applyWidth(startWidth + (e.clientX - startX));
    };

    const onLostPointerCapture = () => {
      splitter.classList.remove("is-dragging");
      dialogRoot?.classList.remove("is-resizing");
      splitter.removeEventListener("pointermove", onPointerMove);
      splitter.removeEventListener("lostpointercapture", onLostPointerCapture);
      setPref(CITATION_DIALOG_COLLECTION_TREE_WIDTH_PREF, currentWidth);
    };

    splitter.addEventListener("pointermove", onPointerMove);
    splitter.addEventListener("lostpointercapture", onLostPointerCapture);
  });

  // Not removed on unload: this listener is bound to the dialog's own window
  // and is torn down with it when the dialog closes, so it leaks nothing. The
  // observers/timers cleaned up in the `unload` handler are different — they
  // would fire callbacks against the dead document during teardown.
  window.addEventListener("resize", () => {
    currentWidth = applyWidth(currentWidth);
  });
}

async function refreshItemsHighlight(): Promise<void> {
  if (!itemsView || !bubbleInput) return;
  const ids = bubbleInput.Cites.map(getCiteItemID).filter(
    (id): id is number => id != null,
  );
  try {
    // Wait for ItemTree.tree (VirtualizedTable ref) to exist. Calling setHighlightedRows
    // too early can throw inside Zotero's ItemTree because it tries to invalidate.
    const deadline = Date.now() + 2000;
    while (!itemsView.tree) {
      if (Date.now() > deadline) return;
      await delay(10);
    }

    await itemsView.setHighlightedRows?.(ids);

    const vt = itemsView.tree;
    vt?.invalidate?.();
    vt?.forceUpdate?.();
  } catch (e) {
    log.error("刷新条目高亮失败", e);
  }
}

function updateAcceptButton(): void {
  if (!acceptButton) {
    return;
  }
  const hasCites = Boolean(bubbleInput && bubbleInput.Cites.length > 0);
  const citationValid = citationPanel?.isValid() ?? true;
  const citesValid = bubbleInput?.validateAll() ?? true;
  acceptButton.disabled = !hasCites || !citationValid || !citesValid;
}

/**
 * Several listeners in one event (cite change, citation control refresh) can
 * ask for the same button state; validate once per task instead of once per
 * call. `validateAll()` runs every cite's style-declared validators.
 */
let acceptUpdateQueued = false;
function scheduleAcceptUpdate(): void {
  if (acceptUpdateQueued) return;
  acceptUpdateQueued = true;
  queueMicrotask(() => {
    acceptUpdateQueued = false;
    updateAcceptButton();
  });
}

function buildCitationContext(): CitationContext {
  return {
    id: "citation-dialog",
    page: 0,
    cites: bubbleInput?.Cites ?? [],
    params: citationParams,
  } as CitationContext;
}

function citationState(control: CitationParam): ParamState {
  const resolved = resolveCitation();
  return (
    resolved.states[control.id] ?? {
      mode: "free",
      value: citationParams[control.id] ?? "",
    }
  );
}

function resolvedCitationContext(): CitationContext {
  return resolveCitation().citation;
}

function resolveCitation(): ResolvedCitation {
  citationResolution ??= resolveCitationParamValues(
    citationDeclarations,
    buildCitationContext(),
    styleOptions,
  );
  return citationResolution;
}

/** The citation context changed: cites, citation params, declarations or options. */
function invalidateCitationResolution(): void {
  citationResolution = null;
}

function renderCitationOptions(controls: CitationParam[]): void {
  const footer = document.querySelector("footer") as HTMLElement | null;
  if (!footer) return;

  // Create a container for options if it doesn't exist
  let container = document.getElementById(
    "citation-options-container",
  ) as HTMLElement | null;
  if (!container) {
    container = document.createElement("div");
    container.id = "citation-options-container";

    footer.appendChild(container);
  }

  const values: Record<string, ScalarValue> = {};
  for (const control of controls) {
    values[control.id] = initialParameterValue(
      control,
      citationParams[control.id],
    );
  }

  citationPanel = new ParameterPanel<CitationParam>({
    container,
    controls,
    values,
    mode: "xul",
    createXULElementCompat,
    getState: citationState,
    onChange: (control, value) => {
      citationParams[control.id] = value;
      invalidateCitationResolution();
      bubbleInput?.refreshOpenPopup();
    },
    onValidityChange: () => scheduleAcceptUpdate(),
  });
  citationPanel.render();
  updateAcceptButton();
}
