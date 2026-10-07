import {
  doiToUrl,
  getComparableFields,
  getCreatorSnapshots,
  hasNonLanguageChanges,
  isSameItemContent,
  normalizeLanguageCode,
  reloadItemContent,
  snapshotItemContent,
} from "../utils/multilingualDraft";
import { useL10n } from "../utils/locale";
import { unwrapMultilingualDialogIO } from "../utils/multilingualDialogIO";
import { createRetargetScheduler } from "../utils/retargetScheduler";
// Side-effect import: registers the custom element (a type import is dropped).
import "./multilingualItemEditor";
import type { MultilingualItemEditor } from "./multilingualItemEditor";
import type { ItemContentSnapshot } from "../../typings/multilingualItem";
import type { MultilingualItemDialogIO as IO } from "../../typings/multilingualItemDialog";

type SourceSnapshot = ItemContentSnapshot;

const t = useL10n(["multilingualItemDialog.ftl"]);
const ATTACHMENT_PRIORITY: Record<string, number> = {
  pdf: 0,
  epub: 1,
  snapshot: 2,
};

let io: IO | null = null;
let sourceItem: Zotero.Item | null = null;
let draftItem: Zotero.Item | null = null;
let sourceReader: _ZoteroTypes.ReaderPreview | null = null;
// "Open externally" action, replaced per render; the shared listener reads it.
let externalSourceOpen: (() => void) | null = null;
let pageUpdateTimer: number | null = null;
let resolved = false;
let splitPointerID: number | null = null;
let edgeDragPointerId: number | null = null;
let edgeDragStartX: number | null = null;
let reloadGeneration = 0;
let busy = false;
// Guards `onAccept()` before `busy` rises; its first check is async.
let accepting = false;
// Set before our own `window.close()` so the `close` guard lets it pass.
let closing = false;
// `reader.lastSidebarTab` captured on open and restored on dispose.
let savedSidebarTab: string | null = null;
// Pref observer, last observed view, and write by this reader (`null` = none).
let sidebarTabObserverID: symbol | null = null;
let observedReaderSidebarView: string | null = null;
let ownSidebarTabWrite: string | null = null;
let sourceSnapshot: SourceSnapshot | null = null;
let sourcePlaceholderMessage: string | null = null;
let dialogMessage: string | null = null;
let dialogMessageIsError = false;
let dialogMessageDismissOnEdit = false;
let duplicateLanguageItem: Zotero.Item | null = null;
// Set once `load` fired: the editor only exists after the document is parsed,
// so a retarget that arrives earlier is queued instead of loaded.
let windowReady = false;
let queuedTarget: IO | null = null;

/** Serializes the retarget decisions; loading stays fire-and-forget. */
const scheduler = createRetargetScheduler<IO>({
  isBlocked: () => busy || accepting,
  isAcceptable: (target) => {
    const item = target.sourceItem;
    return Boolean(item?.isRegularItem?.());
  },
  isCurrent: (target) =>
    target.sourceItem.id === sourceItem?.id &&
    draftItem !== null &&
    sourceSnapshot !== null &&
    !isCurrentSessionStale(),
  hasUnsavedEdits: () => hasUnsavedEdits(),
  confirmDiscard: () => confirmDiscardEdits(),
  supersede: (target) => {
    target.superseded = true;
    target.deferred.resolve();
  },
  load: (target) => {
    if (!windowReady) {
      // Keep the newest target; `init()` loads it once the window is ready.
      if (queuedTarget && queuedTarget !== target) {
        queuedTarget.superseded = true;
        queuedTarget.deferred.resolve();
      }
      queuedTarget = target;
      return;
    }
    void loadSession(target);
  },
});

// Install the retarget hook while the script evaluates: the opener reads it
// through `arguments[0]`, and a name-only window it just found is not loaded
// yet. Waiting for `load` here would open a second editor instead.
const initialIO = unwrapMultilingualDialogIO(window.arguments?.[0]);
if (initialIO) {
  initialIO.reload = (candidate: IO): boolean => scheduler.request(candidate);
}
// Mirrors the reader app's `SIDEBAR_MIN_WIDTH` (`sidebar-resizer.js`).
const READER_SIDEBAR_MIN_WIDTH = 180;
// Sidebar width on open; set before `_open()` so the split view lays out.
const READER_SIDEBAR_WIDTH = 220;
// No timeout inside `ReaderPreview`; fail instead of hanging on a stalled view.
const READER_OPEN_TIMEOUT_MS = 10000;
let previousOpenSidebarWidth: number | null = null;

window.addEventListener("load", () => void init());
window.addEventListener("beforeunload", disposeSourceReader);
// Refuse a native close while saving: closing tears down this realm before the
// save settles the opener; `closing` lets our own close pass.
window.addEventListener("close", (event) => {
  if ((busy || accepting) && !closing) {
    event.preventDefault();
    showStatus(t("multilingual-item-saving"));
  }
});
window.addEventListener("unload", () => {
  if (pageUpdateTimer !== null) {
    window.clearInterval(pageUpdateTimer);
    pageUpdateTimer = null;
  }
  disposeSourceReader();
  // With a commit in flight the opener settles the deferred itself.
  if (!resolved && !busy && !accepting) {
    finish(io, null);
  }
});

function prepareDraftItem(draft: Zotero.Item): void {
  // Clones have null dates; set "now" so the editor renders a valid value.
  const now = Zotero.Date.dateToSQL(new Date(), true);
  draft.dateAdded = now;
  draft.dateModified = now;
  // Multilingual copies are citation records; summaries stay on the source.
  draft.setField("abstractNote", "");
  draft.setRelations({
    "dc:relation": [],
    "owl:sameAs": [],
    "dc:replaces": [],
  });
}

async function init(): Promise<void> {
  // Registration provides the density attribute defining `editable-text`'s
  // padding. Register the body, not the root: `1rem` resolves against itself.
  if (document.body) {
    Zotero.UIProperties.registerRoot(document.body);
  }
  bindEvents();
  windowReady = true;
  // A retarget can win the race against `load`: it only needs the window, not
  // the editor. This window's own arguments are stale then and must not pull
  // the dialog back to the item it was opened for.
  const target = queuedTarget ?? initialIO;
  queuedTarget = null;
  if (!target) {
    showError(t("multilingual-item-error-init"));
    return;
  }
  if (target !== initialIO && initialIO) {
    initialIO.superseded = true;
    initialIO.deferred.resolve();
  }
  await loadSession(target);
}

/**
 * Build a fresh session for `next`; staleness is caught by `reloadGeneration`.
 */
async function loadSession(next: IO): Promise<void> {
  const generation = ++reloadGeneration;
  try {
    if (io && io !== next) {
      io.superseded = true;
      io.deferred.resolve();
    }
    io = next;
    // Install the retarget hook the opener reads via `arguments[0]`.
    next.reload = (candidate: IO): boolean => scheduler.request(candidate);
    sourceItem = next.sourceItem;

    resetSessionState();

    if (!sourceItem.isRegularItem() || !sourceItem.isEditable()) {
      showError(t("multilingual-item-error-source-not-editable"));
      return;
    }
    const languageFieldID = Zotero.ItemFields.getID("language");
    if (
      languageFieldID === false ||
      !Zotero.ItemFields.isValidForType(languageFieldID, sourceItem.itemTypeID)
    ) {
      showError(t("multilingual-item-error-language-unsupported"));
      return;
    }

    draftItem = sourceItem.clone(sourceItem.libraryID, {
      skipTags: true,
      includeCollections: true,
    });
    prepareDraftItem(draftItem);
    initItemEditor(draftItem);
    sourceSnapshot = snapshotItemContent(sourceItem);
    await renderSourceMaterial(sourceItem, generation);
  } catch (error) {
    if (generation !== reloadGeneration) {
      return;
    }
    ztoolkit.logError(error);
    showError(
      error instanceof Error
        ? error.message
        : t("multilingual-item-error-init"),
    );
  }
}

/** Single reset point for per-source state; also tears down the reader. */
function resetSessionState(): void {
  disposeSourceReader();
  setSourceSpinner(false);
  setSourcePlaceholder(null);
  setSourceError(null);
  // Also clears `duplicateLanguageItem`.
  clearError();
  setBusy(false);
  resetSourceToolbarState();
  previousOpenSidebarWidth = null;
  externalSourceOpen = null;
  splitPointerID = null;
  edgeDragPointerId = null;
  edgeDragStartX = null;
  sourceSnapshot = null;
  draftItem = null;
  resolved = false;
}

/** Point the editor at a draft; nothing is written until Save commits. */
function initItemEditor(item: Zotero.Item): void {
  const editor = getItemEditor();
  if (!editor) {
    throw new Error(t("multilingual-item-error-init"));
  }
  // Both at once: the single setters would rebuild the table twice.
  editor.configure(item, true);
}

function bindEvents(): void {
  document
    .getElementById("accept-button")
    ?.addEventListener("click", () => void onAccept());
  document.getElementById("cancel-button")?.addEventListener("click", onCancel);
  document
    .getElementById("duplicate-use-existing")
    ?.addEventListener("click", useExistingLanguageItem);
  document
    .getElementById("duplicate-keep-editing")
    ?.addEventListener("click", keepEditingLanguage);
  document
    .getElementById("sidebar-toggle")
    ?.addEventListener("click", toggleReaderSidebar);
  document
    .getElementById("zoom-in")
    ?.addEventListener("click", () => zoomReader("in"));
  document
    .getElementById("zoom-out")
    ?.addEventListener("click", () => zoomReader("out"));
  document
    .getElementById("open-source-button")
    ?.addEventListener("click", () => externalSourceOpen?.());
  // Capture phase: the focused `editable-text` consumes Enter.
  document.addEventListener("keydown", onAcceptShortcut, true);
  document.addEventListener("keydown", onKeydown);
  // Real input only: programmatic focus must not dismiss the error it raised.
  const editorPane = document.getElementById("editor-pane");
  editorPane?.addEventListener("pointerdown", dismissEditableMessage);
  editorPane?.addEventListener("keydown", dismissEditableMessage);
  document.getElementById("page-first")?.addEventListener("click", () => {
    void navigateReader("first");
  });
  document.getElementById("page-previous")?.addEventListener("click", () => {
    void navigateReader("previous");
  });
  document.getElementById("page-next")?.addEventListener("click", () => {
    void navigateReader("next");
  });
  document.getElementById("page-last")?.addEventListener("click", () => {
    void navigateReader("last");
  });
  const pageInput = document.getElementById(
    "reader-page-index",
  ) as HTMLInputElement | null;
  // Enter fires `change`, so this one listener covers Enter and blur.
  pageInput?.addEventListener("change", () => void navigateReaderToInput());

  const splitter = document.getElementById("pane-splitter");
  splitter?.addEventListener("pointerdown", onSplitPointerDown);
  window.addEventListener("pointermove", onSplitPointerMove);
  window.addEventListener("pointerup", onSplitPointerUp);
  window.addEventListener("pointercancel", onSplitPointerUp);

  const sidebarEdge = document.getElementById("sidebar-edge");
  sidebarEdge?.addEventListener("pointerdown", onEdgePointerDown);
  window.addEventListener("pointermove", onEdgePointerMove);
  window.addEventListener("pointerup", onEdgePointerUp);
  window.addEventListener("pointercancel", onEdgePointerUp);
}

async function renderSourceMaterial(
  item: Zotero.Item,
  generation: number,
): Promise<void> {
  if (generation !== reloadGeneration) {
    return;
  }
  const viewer = document.getElementById("source-viewer") as HTMLElement | null;
  const openButton = document.getElementById("open-source-button");
  if (!viewer || !openButton) return;

  viewer.replaceChildren();
  externalSourceOpen = null;
  setSourceSpinner(false);
  setSourcePlaceholder(null);
  setSourceError(null);
  await item.loadDataType("childItems");
  if (generation !== reloadGeneration) {
    return;
  }
  const attachments = await Zotero.Items.getAsync(item.getAttachments());
  if (generation !== reloadGeneration) {
    return;
  }
  const supportedAttachments = attachments
    .filter(
      (attachment) =>
        attachment.isFileAttachment() &&
        attachment.attachmentReaderType in ATTACHMENT_PRIORITY,
    )
    .sort(
      (a, b) =>
        ATTACHMENT_PRIORITY[a.attachmentReaderType] -
        ATTACHMENT_PRIORITY[b.attachmentReaderType],
    );

  let attachment: Zotero.Item | null = null;
  for (const candidate of supportedAttachments) {
    const exists = await candidate.fileExists();
    if (generation !== reloadGeneration) {
      return;
    }
    if (exists) {
      attachment = candidate;
      break;
    }
  }
  if (generation !== reloadGeneration) {
    return;
  }

  if (attachment) {
    openButton.toggleAttribute("hidden", false);
    externalSourceOpen = () => {
      void openAttachmentExternally(attachment);
    };
    try {
      await renderReaderAttachment(attachment, viewer, generation);
    } catch (error) {
      if (generation !== reloadGeneration) {
        return;
      }
      ztoolkit.logError(error);
      // Tear the reader down on failure: `_open()` may have registered observers.
      disposeSourceReader();
      viewer.replaceChildren();
      setSourceSpinner(false);
      setSourceError(t("multilingual-item-source-preview-failed"));
    }
    return;
  }

  const urlAttachment = attachments.find(
    (candidate) =>
      candidate.isWebAttachment() &&
      getSafeHTTPURL(candidate.getField("url")) !== null,
  );
  // Without a reader attachment, prefer a DOI resolver over the item's `url`.
  const doiUrl = doiToUrl(item.getField("DOI"));
  const url =
    (urlAttachment && getSafeHTTPURL(urlAttachment.getField("url"))) ||
    (doiUrl && getSafeHTTPURL(doiUrl)) ||
    getSafeHTTPURL(item.getField("url"));
  if (url) {
    if (generation !== reloadGeneration) {
      return;
    }
    // An HTML iframe cannot load remote pages in chrome; use a *remote* XUL
    // `<browser>` (non-remote ones cannot load ordinary external sites).
    const frame = document.createXULElement("browser");
    frame.setAttribute("type", "content");
    frame.setAttribute("remote", "true");
    frame.setAttribute("maychangeremoteness", "true");
    frame.setAttribute("disableglobalhistory", "true");
    frame.setAttribute("aria-label", t("multilingual-item-source-webpage"));
    frame.classList.add("source-frame");
    // No spinner: a remote browser's document is unreachable from chrome.
    frame.setAttribute("src", url);
    viewer.append(frame);
    openButton.toggleAttribute("hidden", false);
    externalSourceOpen = () => Zotero.launchURL(url);
    return;
  }

  if (generation !== reloadGeneration) {
    return;
  }
  openButton.toggleAttribute("hidden", true);
  setSourcePlaceholder(t("multilingual-item-source-unavailable"));
}

async function openAttachmentExternally(
  attachment: Zotero.Item,
): Promise<void> {
  try {
    const path = await attachment.getFilePathAsync();
    if (path) {
      Zotero.launchFile(path);
      return;
    }
    showError(t("multilingual-item-source-preview-failed"));
  } catch (error) {
    ztoolkit.logError(error);
    showError(t("multilingual-item-source-preview-failed"));
  }
}

async function renderReaderAttachment(
  attachment: Zotero.Item,
  viewer: HTMLElement,
  generation: number,
): Promise<void> {
  if (generation !== reloadGeneration) {
    return;
  }
  // XUL <browser>, not an iframe: an iframe never fired its `load` handler.
  const readerFrame = document.createXULElement("browser");
  readerFrame.setAttribute(
    "aria-label",
    t("multilingual-item-source-attachment", {
      args: { type: attachment.attachmentReaderType.toUpperCase() },
    }),
  );
  readerFrame.setAttribute("type", "content");
  readerFrame.setAttribute("primary", "true");
  readerFrame.setAttribute("transparent", "transparent");
  readerFrame.setAttribute("src", "resource://zotero/reader/reader.html");
  readerFrame.classList.add("source-frame");
  viewer.append(readerFrame);
  setSourceSpinner(true);

  await waitForReaderApp(readerFrame, generation);
  if (generation !== reloadGeneration) {
    return;
  }
  setSourceSpinner(false);
  // Inject host styles first, else the stock toolbar flashes until `_open()`.
  const readerAppDocument = getReaderContentWindow(readerFrame)?.document;
  if (readerAppDocument) applyReaderHostStyles(readerAppDocument);

  const reader = await Zotero.Reader.openPreview(attachment.id, readerFrame);
  if (generation !== reloadGeneration) {
    try {
      reader.uninit();
    } catch {
      // The host may already be tearing down while switching sources.
    }
    return;
  }
  sourceReader = reader;
  // Drive the plain `ReaderInstance._open()` with `preview: false` (as
  // `ReaderWindow` does); a preview lacks the `_popupset`/`_window` for menus.
  sourceReader._popupset = document.getElementById("reader-popupset");
  sourceReader._window = window;
  // `_open()` sizes the split view before the first render; resizing after
  // `_open()` aborts PDF.js auto-linking mid-annotation-render.
  sourceReader._sidebarWidth = READER_SIDEBAR_WIDTH;
  sourceReader._sidebarOpen = true;
  // Seed the "last comfortable width" so a first drag to the minimum collapses.
  previousOpenSidebarWidth = READER_SIDEBAR_WIDTH;
  captureSidebarTabPref();
  sourceReader._onToggleSidebarCallback = onSidebarToggled;
  sourceReader._onChangeSidebarWidthCallback = onSidebarWidthChanged;
  const openResult = await openReaderWithoutPreview(
    sourceReader,
    getInitialReaderState(attachment.attachmentReaderType),
    generation,
  );
  if (generation !== reloadGeneration || !sourceReader) {
    return;
  }
  if (!openResult) {
    throw new Error(t("multilingual-item-source-preview-failed"));
  }

  // PDFs start on thumbnails; the outline loads silently in the background.
  sourceReader.setSidebarView(
    attachment.attachmentReaderType === "pdf" ? "thumbnails" : "outline",
  );
  syncObservedSidebarView();
  if (attachment.attachmentReaderType === "pdf") {
    void resolvePdfOutline(sourceReader);
  }
  installZoomOnlyContextMenu(sourceReader);

  const controls = document.getElementById(
    "source-controls",
  ) as HTMLElement | null;
  if (controls) controls.hidden = false;
  for (const id of ["sidebar-toggle", "zoom-in", "zoom-out"]) {
    const button = document.getElementById(id) as HTMLButtonElement | null;
    if (button) button.hidden = false;
  }
  document
    .getElementById("source-divider-tools")
    ?.toggleAttribute("hidden", false);
  updateReaderPageControls();
  pageUpdateTimer = window.setInterval(updateReaderPageControls, 200);
}

/**
 * Run the plain `ReaderInstance._open()` with `preview: false`, then wait for
 * the reader app; not patching the shared prototype avoids a dead-realm leak.
 */
async function openReaderWithoutPreview(
  reader: _ZoteroTypes.ReaderPreview,
  state: _ZoteroTypes.Reader.State | undefined,
  generation: number,
): Promise<boolean> {
  if (generation !== reloadGeneration) {
    return false;
  }
  const readerInstancePrototype: _ZoteroTypes.ReaderInstancePrototype =
    Object.getPrototypeOf(Object.getPrototypeOf(reader));
  const baseOpen = readerInstancePrototype._open;

  let timeoutId = 0;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = window.setTimeout(
      () => reject(new Error(t("multilingual-item-error-reader-timeout"))),
      READER_OPEN_TIMEOUT_MS,
    );
  });
  // Swallow late rejections; failures return through the boolean result.
  const open = (async (): Promise<boolean> => {
    try {
      const success = await baseOpen.call(reader, { state, preview: false });
      if (!success) {
        return false;
      }
      return await reader._waitForInternalReader();
    } catch (error) {
      ztoolkit.logError(error);
      return false;
    }
  })();
  try {
    return await Promise.race([open, timeout]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

/**
 * Initial view state per reader type; EPUB/snapshot omit it for `_getState()`.
 */
function getInitialReaderState(
  readerType: string,
): _ZoteroTypes.Reader.State | undefined {
  if (readerType !== "pdf") {
    return undefined;
  }
  return {
    pageIndex: 0,
    scale: "page-width",
    top: 0,
    left: 0,
    scrollMode: 0,
    spreadMode: 0,
  };
}

/**
 * Resolve a PDF outline without entering reading mode or taking the sidebar.
 */
async function resolvePdfOutline(
  reader: _ZoteroTypes.ReaderPreview,
): Promise<void> {
  try {
    const internal = reader._internalReader;
    // Calling the view method directly performs the lazy fetch without changing
    // `state.sidebarView`; `_primaryView` is a union that hides PDF members.
    const pdfView = internal._primaryView;
    if (typeof pdfView !== "object" || !("setSidebarView" in pdfView)) {
      return;
    }
    // The lazy fetch (`getOutline2()`) pushes into `state.outline` silently.
    try {
      await pdfView.setSidebarView?.("outline");
    } catch (error) {
      // The generated outline below does not depend on this fetch.
      ztoolkit.log(error);
    }
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && sourceReader === reader) {
      const outline = internal._state.outline;
      if (Array.isArray(outline) && outline.length > 0) {
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }
    if (sourceReader !== reader) return;

    // No bookmarks: generate the outline from the structured document.
    ensureSdtPackGetter(reader);
    const sdtData = await loadSdtData(internal);
    if (sourceReader !== reader || !sdtData) return;
    // An Xray wrapper hides prototype methods; waive it as the reader does.
    const sdt =
      Components.utils.waiveXrays<_ZoteroTypes.Reader.SdtData>(sdtData);
    const outline = convertSdtOutlineToPdf(sdt);
    if (outline) {
      internal._updateState?.(
        intoAppRealm<{ outline: _ZoteroTypes.Reader.OutlineItem[] }>(
          { outline },
          sdt,
        ),
      );
    }
  } catch (error) {
    ztoolkit.logError(error);
  }
}

/**
 * Previews are "transient" and refuse the SDT pack service; briefly flip
 * `_isTransient`, mint the getter, then drop the property (synchronous).
 */
function ensureSdtPackGetter(reader: _ZoteroTypes.ReaderPreview): void {
  const internal = reader._internalReader;
  if (internal._getSDTPack) return;
  const createGetter = reader._createGetSDTPack;
  const targetWindow = reader._iframeWindow;
  if (typeof createGetter !== "function" || !targetWindow) return;
  reader._isTransient = () => false;
  try {
    const getPack = createGetter.call(reader, targetWindow);
    if (getPack) {
      internal._getSDTPack = getPack;
    }
  } finally {
    delete reader._isTransient;
  }
}

/** Materialize the SDT structure silently; resolves to null when unavailable. */
async function loadSdtData(
  internal: _ZoteroTypes.Reader.InternalReader<"pdf" | "epub" | "snapshot">,
): Promise<_ZoteroTypes.Reader.SdtData | null> {
  const loadSdt = internal._loadSDT;
  if (typeof loadSdt !== "function") return null;
  try {
    return await loadSdt.call(internal);
  } catch (error) {
    ztoolkit.logError(error);
    return null;
  }
}

/** Convert the SDT catalog outline into PDF-source items via the mapper. */
function convertSdtOutlineToPdf(
  sdt: _ZoteroTypes.Reader.SdtData,
): _ZoteroTypes.Reader.OutlineItem[] | null {
  const catalogOutline = sdt.structure.catalog?.outline;
  if (!Array.isArray(catalogOutline) || !catalogOutline.length) {
    return null;
  }
  const convert = (
    entries: _ZoteroTypes.Reader.SdtOutlineEntry[],
  ): _ZoteroTypes.Reader.OutlineItem[] => {
    const items: _ZoteroTypes.Reader.OutlineItem[] = [];
    for (const entry of entries) {
      const position = entry.ref
        ? getSdtBlockSourcePosition(sdt, entry.ref)
        : null;
      const item: _ZoteroTypes.Reader.OutlineItem = {
        title: entry.title,
        location: position
          ? {
              position: {
                pageIndex: position.pageIndex,
                rects: position.rects,
              },
            }
          : {},
      };
      if (entry.children?.length) {
        item.items = convert(entry.children);
      }
      items.push(item);
    }
    return items;
  };
  const outline = convert(catalogOutline);
  return outline.some(outlineItemHasPosition) ? outline : null;
}

function outlineItemHasPosition(
  item: _ZoteroTypes.Reader.OutlineItem,
): boolean {
  if (item.location?.position) return true;
  return (item.items ?? []).some(outlineItemHasPosition);
}

/** Map an SDT block ref to the source PDF via its first mappable text node. */
function getSdtBlockSourcePosition(
  sdt: _ZoteroTypes.Reader.SdtData,
  ref: number[],
): _ZoteroTypes.Reader.SdtSourcePosition | null {
  const block = getSdtBlockByRef(sdt.structure.content, ref);
  if (!block) return null;
  const content = block.content;
  if (!Array.isArray(content)) return null;
  for (let index = 0; index < content.length; index++) {
    const node = content[index];
    if (!node || typeof node.text !== "string" || !node.text.length) {
      continue;
    }
    const position = sdtToSourcePosition(sdt, [
      [...ref, index, 0],
      [...ref, index, node.text.length],
    ]);
    if (position) {
      return copySourcePosition(position);
    }
  }
  return null;
}

/**
 * Run the SDT position mapper for a start/end point pair; its argument must be
 * realm-native in the reader app.
 */
function sdtToSourcePosition(
  sdt: _ZoteroTypes.Reader.SdtData,
  points: [start: number[], end: number[]],
): _ZoteroTypes.Reader.SdtSourcePosition | null {
  return sdt.mapper.sdtToSourcePosition(
    intoAppRealm<_ZoteroTypes.Reader.SdtPosition>(
      { start: points[0], end: points[1] },
      sdt,
    ),
  );
}

function intoAppRealm<T>(value: T, sdt: _ZoteroTypes.Reader.SdtData): T {
  const appGlobal = Components.utils.getGlobalForObject(sdt);
  return Components.utils.cloneInto<T>(value, appGlobal);
}

function copySourcePosition(
  position: _ZoteroTypes.Reader.SdtSourcePosition,
): _ZoteroTypes.Reader.SdtSourcePosition {
  const rects: number[][] = [];
  for (const rect of position.rects ?? []) {
    rects.push([...rect]);
  }
  return { pageIndex: position.pageIndex, rects };
}

function getSdtBlockByRef(
  content: _ZoteroTypes.Reader.SdtNode[],
  ref: number[],
): _ZoteroTypes.Reader.SdtNode | null {
  if (!ref.length) return null;
  let node: _ZoteroTypes.Reader.SdtNode | undefined = content[ref[0]];
  for (let i = 1; i < ref.length; i++) {
    node = node?.content?.[ref[i]];
  }
  return node ?? null;
}

/** Keep only the context menu's zoom group, matched by localized label. */
function installZoomOnlyContextMenu(reader: _ZoteroTypes.ReaderPreview): void {
  const readerPrototype: _ZoteroTypes.ReaderInstancePrototype =
    Object.getPrototypeOf(Object.getPrototypeOf(reader));
  const baseOpenContextMenu = readerPrototype._openContextMenu;
  reader._openContextMenu = (params) => {
    const zoomLabels = new Set(
      [
        "reader-zoom-in",
        "reader-zoom-out",
        "reader-zoom-reset",
        "reader-zoom-auto",
        "reader-zoom-page-width",
        "reader-zoom-page-height",
      ].map((key) => reader._getString(key)),
    );
    // These arrays cross the Xray boundary: never pass a chrome callback into
    // them (e.g. `Array.prototype.map(chromeFn)`), which throws "Permission
    // denied to pass object to privileged code"; plain iteration is safe.
    const itemGroups: _ZoteroTypes.Reader.ContextMenuItem[][] = [];
    for (const group of params.itemGroups) {
      const kept: _ZoteroTypes.Reader.ContextMenuItem[] = [];
      for (const item of group) {
        if (item && item.label && zoomLabels.has(item.label)) {
          kept.push(item);
        }
      }
      if (kept.length) {
        itemGroups.push(kept);
      }
    }
    if (!itemGroups.length) {
      return Promise.resolve();
    }
    return baseOpenContextMenu.call(reader, {
      x: params.x,
      y: params.y,
      itemGroups,
    });
  };
}

function getReaderContentWindow(
  readerFrame: XULBrowserElement,
): _ZoteroTypes.ReaderContentWindow | null {
  return readerFrame.contentWindow;
}

/** Poll for `window.createReader`; the frame `load` event was unreliable. */
async function waitForReaderApp(
  readerFrame: XULBrowserElement,
  generation: number,
): Promise<void> {
  const deadline = Date.now() + 15000;
  while (
    generation === reloadGeneration &&
    !getReaderContentWindow(readerFrame)?.wrappedJSObject?.createReader
  ) {
    if (Date.now() >= deadline) {
      throw new Error(t("multilingual-item-error-reader-timeout"));
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
}

function disposeSourceReader(): void {
  if (pageUpdateTimer !== null) {
    window.clearInterval(pageUpdateTimer);
    pageUpdateTimer = null;
  }
  const reader = sourceReader;
  sourceReader = null;
  if (reader) {
    try {
      const blockingObserver = reader._blockingObserver;
      reader._blockingObserver = null;
      blockingObserver?.dispose();
      reader.uninit();
    } catch {
      // The browser may already be gone if the host window is shutting down.
    }
  }
  restoreSidebarTabPref();
}

function readerSidebarView(): string | null {
  return sourceReader?._internalReader?._state?.sidebarView ?? null;
}

/**
 * The app writes the global `reader.lastSidebarTab` pref on user-driven changes;
 * capture and restore it on dispose. The observer tells our writes from others'.
 */
function captureSidebarTabPref(): void {
  if (sidebarTabObserverID !== null) {
    Zotero.Prefs.unregisterObserver(sidebarTabObserverID);
    sidebarTabObserverID = null;
  }
  const value = Zotero.Prefs.get("reader.lastSidebarTab");
  savedSidebarTab = typeof value === "string" ? value : "";
  observedReaderSidebarView = readerSidebarView();
  ownSidebarTabWrite = null;
  sidebarTabObserverID = Zotero.Prefs.registerObserver(
    "reader.lastSidebarTab",
    () => {
      const view = readerSidebarView();
      if (!view || view === observedReaderSidebarView) {
        return;
      }
      observedReaderSidebarView = view;
      ownSidebarTabWrite = view;
    },
  );
}

/** Record the view set programmatically so a later foreign write is not ours. */
function syncObservedSidebarView(): void {
  observedReaderSidebarView = readerSidebarView();
}

function restoreSidebarTabPref(): void {
  if (sidebarTabObserverID !== null) {
    Zotero.Prefs.unregisterObserver(sidebarTabObserverID);
    sidebarTabObserverID = null;
  }
  const ownWrite = ownSidebarTabWrite;
  ownSidebarTabWrite = null;
  observedReaderSidebarView = null;
  if (savedSidebarTab === null) {
    return;
  }
  const saved = savedSidebarTab;
  savedSidebarTab = null;
  // Revert our own write only while it is current; a later foreign write wins.
  if (ownWrite === null) {
    return;
  }
  if (Zotero.Prefs.get("reader.lastSidebarTab") !== ownWrite) {
    return;
  }
  if (saved) {
    Zotero.Prefs.set("reader.lastSidebarTab", saved);
  } else {
    Zotero.Prefs.clear("reader.lastSidebarTab");
  }
}

/** Hide the reader's own toolbar before the app renders, or it flashes. */
function applyReaderHostStyles(readerDocument: Document): void {
  const style = readerDocument.createElement("style");
  style.textContent = `
    #split-view, .split-view {
      top: 0 !important;
    }
    #sidebarContainer {
      top: 0 !important;
    }
    /* The stock top offset compensates for the reader's own toolbar, which
       we hide; let the sidebar resizer cover the full height. */
    .sidebar-resizer {
      top: 0 !important;
    }
    #reader-ui .toolbar {
      display: none !important;
    }
    /* This read-only host never has usable annotations; drop the tab. */
    #viewAnnotations {
      display: none !important;
    }
  `;
  readerDocument.head?.append(style);
}

function updateReaderPageControls(): void {
  updateReaderToolbar();
  const stats = sourceReader?._internalReader._state.primaryViewStats;
  if (!stats) return;

  const pageIndex = stats.pageIndex ?? 0;
  const pagesCount = stats.pagesCount ?? 0;
  const pageInput = document.getElementById(
    "reader-page-index",
  ) as HTMLInputElement | null;
  const pageCount = document.getElementById("reader-page-count");
  const pageValue = String(pageIndex + 1);
  if (
    pageInput &&
    document.activeElement !== pageInput &&
    pageInput.value !== pageValue
  ) {
    pageInput.value = pageValue;
  }
  const pageCountValue = String(pagesCount);
  if (pageCount && pageCount.textContent !== pageCountValue) {
    pageCount.textContent = pageCountValue;
  }

  setPageButtonDisabled("page-first", pageIndex <= 0);
  setPageButtonDisabled("page-previous", pageIndex <= 0);
  setPageButtonDisabled("page-next", pageIndex + 1 >= pagesCount);
  setPageButtonDisabled("page-last", pageIndex + 1 >= pagesCount);

  // Snapshots have no pagination; hide the page controls and their divider.
  const showPageControls = pagesCount > 0;
  const controls = document.getElementById("source-controls");
  controls?.toggleAttribute("hidden", !showPageControls);
  document
    .getElementById("source-divider-pages")
    ?.toggleAttribute("hidden", !showPageControls);
}

function setPageButtonDisabled(id: string, disabled: boolean): void {
  const button = document.getElementById(id) as HTMLButtonElement | null;
  if (button && button.disabled !== disabled) button.disabled = disabled;
}

function toggleReaderSidebar(): void {
  if (!sourceReader) return;
  const internal = sourceReader._internalReader;
  sourceReader.toggleSidebar(!internal._state.sidebarOpen);
  updateReaderToolbar();
}

function updateReaderToolbar(): void {
  const internal = sourceReader?._internalReader;
  const sidebarEdge = document.getElementById(
    "sidebar-edge",
  ) as HTMLElement | null;
  if (!internal) {
    if (sidebarEdge && !sidebarEdge.hidden) sidebarEdge.hidden = true;
    return;
  }

  const { sidebarOpen, primaryViewStats } = internal._state;
  if (sidebarEdge && sidebarEdge.hidden !== sidebarOpen) {
    // The handle only matters while the reader's own resizer is unmounted.
    sidebarEdge.hidden = sidebarOpen;
  }
  const sidebarToggle = document.getElementById(
    "sidebar-toggle",
  ) as HTMLButtonElement | null;
  if (sidebarToggle) {
    const pressed = String(sidebarOpen);
    if (sidebarToggle.getAttribute("aria-pressed") !== pressed) {
      sidebarToggle.setAttribute("aria-pressed", pressed);
    }
  }
  const zoomInButton = document.getElementById(
    "zoom-in",
  ) as HTMLButtonElement | null;
  if (zoomInButton && zoomInButton.disabled === primaryViewStats.canZoomIn) {
    zoomInButton.disabled = !primaryViewStats.canZoomIn;
  }
  const zoomOutButton = document.getElementById(
    "zoom-out",
  ) as HTMLButtonElement | null;
  if (zoomOutButton && zoomOutButton.disabled === primaryViewStats.canZoomOut) {
    zoomOutButton.disabled = !primaryViewStats.canZoomOut;
  }
}

/** Zoom through the internal reader (the proxy forwards `zoomIn`/`zoomOut`). */
function zoomReader(direction: "in" | "out"): void {
  const reader = sourceReader;
  if (!reader) return;
  if (direction === "in") {
    reader.zoomIn();
  } else {
    reader.zoomOut();
  }
  updateReaderToolbar();
}

/** Mirror the main window's splitter: minimum drag collapses the sidebar. */
function onSidebarWidthChanged(width: number): void {
  if (edgeDragPointerId !== null) {
    // The collapsed-edge drag drives the width itself.
    previousOpenSidebarWidth = width;
    return;
  }
  if (width > READER_SIDEBAR_MIN_WIDTH) {
    previousOpenSidebarWidth = width;
    return;
  }
  const restore = previousOpenSidebarWidth;
  previousOpenSidebarWidth = null;
  if (restore !== null && restore > READER_SIDEBAR_MIN_WIDTH) {
    sourceReader?.toggleSidebar(false);
    sourceReader?.setSidebarWidth(restore);
  }
  updateReaderToolbar();
}

/** Called by the reader when the sidebar is shown/hidden (user-driven). */
function onSidebarToggled(open: boolean): void {
  if (!open) {
    previousOpenSidebarWidth = null;
  }
  updateReaderToolbar();
}

function navigateReader(
  destination: "first" | "previous" | "next" | "last",
): void {
  if (!sourceReader) return;
  switch (destination) {
    case "first":
      sourceReader.navigateToFirstPage();
      break;
    case "previous":
      sourceReader.navigateToPreviousPage();
      break;
    case "next":
      sourceReader.navigateToNextPage();
      break;
    case "last":
      sourceReader.navigateToLastPage();
      break;
  }
  updateReaderPageControls();
}

async function navigateReaderToInput(): Promise<void> {
  if (!sourceReader) return;
  const pageInput = document.getElementById(
    "reader-page-index",
  ) as HTMLInputElement | null;
  const pageNumber = Number(pageInput?.value);
  const pagesCount =
    sourceReader._internalReader._state.primaryViewStats.pagesCount ?? 0;
  if (
    !Number.isInteger(pageNumber) ||
    pageNumber < 1 ||
    pageNumber > pagesCount
  ) {
    updateReaderPageControls();
    return;
  }
  await sourceReader.navigate({ pageIndex: pageNumber - 1 });
  updateReaderPageControls();
}

function getSafeHTTPURL(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function setSourceSpinner(active: boolean): void {
  const spinner = document.getElementById("source-spinner");
  spinner?.toggleAttribute("hidden", !active);
}

function setSourcePlaceholder(message: string | null): void {
  sourcePlaceholderMessage = message;
  renderSourceMessage();
}

/** Red error strip over the viewer, like the reader's own error bar. */
function setSourceError(message: string | null): void {
  const banner = document.getElementById("source-error-banner");
  if (!banner) return;
  banner.textContent = message ?? "";
  banner.toggleAttribute("hidden", !message);
}

/** Show a message over the source pane; `dismissOnEdit` ones clear on edit. */
function showError(message: string, dismissOnEdit = false): void {
  dialogMessage = message;
  dialogMessageIsError = true;
  dialogMessageDismissOnEdit = dismissOnEdit;
  renderSourceMessage();
}

function showStatus(message: string): void {
  dialogMessage = message;
  dialogMessageIsError = false;
  dialogMessageDismissOnEdit = false;
  renderSourceMessage();
}

function clearError(): void {
  dialogMessage = null;
  dialogMessageIsError = false;
  dialogMessageDismissOnEdit = false;
  duplicateLanguageItem = null;
  renderSourceMessage();
}

function dismissEditableMessage(): void {
  if (dialogMessageDismissOnEdit && !busy) {
    clearError();
  }
}

function renderSourceMessage(): void {
  const placeholder = document.getElementById("source-placeholder");
  if (!placeholder) return;
  const hasDialogMessage = dialogMessage !== null;
  const message = hasDialogMessage ? dialogMessage : sourcePlaceholderMessage;
  const messageText = document.getElementById("source-placeholder-message");
  if (messageText) messageText.textContent = message ?? "";
  const duplicateActions = document.getElementById(
    "duplicate-language-actions",
  );
  duplicateActions?.toggleAttribute(
    "hidden",
    !hasDialogMessage || !duplicateLanguageItem,
  );
  placeholder.toggleAttribute("hidden", !message);
  placeholder.toggleAttribute("data-overlay", hasDialogMessage);
  placeholder.setAttribute("role", dialogMessageIsError ? "alert" : "status");
  placeholder.setAttribute(
    "aria-live",
    dialogMessageIsError ? "assertive" : "polite",
  );
}

/**
 * Whether the source still holds the content this session was built from;
 * timestamps change for metadata outside the copy policy.
 */
function hasSourceChanged(
  item: Zotero.Item,
  snapshot: SourceSnapshot,
): boolean {
  return !isSameItemContent(snapshot, snapshotItemContent(item));
}

/**
 * Whether the loaded session no longer reflects its source; a stale session
 * must not swallow a re-trigger as "already current".
 */
function isCurrentSessionStale(): boolean {
  const item = sourceItem;
  const snapshot = sourceSnapshot;
  if (!item) {
    return false;
  }
  return (
    !snapshot || !draftItem || item.deleted || hasSourceChanged(item, snapshot)
  );
}

/**
 * Whether the user would lose edits by loading another source. The editor's
 * focused field counts as well: `editable-text` ignores the blur caused by the
 * window becoming inactive, so typed text may never have reached the draft.
 */
function hasUnsavedEdits(): boolean {
  return draftHasUnsavedEdits() || getItemEditor()?.hasPendingEdit() === true;
}

async function isSourceSessionCurrent(
  item: Zotero.Item | null,
  snapshot: SourceSnapshot | null,
  draft: Zotero.Item | null,
): Promise<boolean> {
  if (!item || !snapshot) {
    return false;
  }
  const storedItem = await Zotero.Items.getByLibraryAndKeyAsync(
    item.libraryID,
    item.key,
    { noCache: true },
  );
  if (storedItem === false) {
    return false;
  }
  await reloadItemContent(storedItem);
  return (
    !storedItem.deleted &&
    storedItem.isEditable() &&
    !hasSourceChanged(storedItem, snapshot) &&
    (!draft ||
      (draft.libraryID === item.libraryID &&
        draft.itemTypeID === storedItem.itemTypeID))
  );
}

/**
 * Whether the draft differs from the source this session loaded; compared
 * against the snapshot, not the live item, so a concurrent edit is not seen.
 */
function draftHasUnsavedEdits(): boolean {
  const snapshot = sourceSnapshot;
  if (!snapshot || !draftItem) {
    return false;
  }
  return (
    draftItem.getField("language") !== (snapshot.fields.language ?? "") ||
    hasNonLanguageChanges(
      snapshot.fields,
      getComparableFields(draftItem),
      snapshot.creators,
      getCreatorSnapshots(draftItem),
    )
  );
}

function confirmDiscardEdits(): boolean {
  return (
    Zotero.Prompt.confirm({
      window,
      title: t("multilingual-item-dialog-title"),
      text: t("multilingual-item-confirm-discard"),
      // Destructive action on button0; the safe action (keep editing) on
      // button1, which is also what Esc and the window close button return.
      button0: t("multilingual-item-confirm-discard-discard"),
      button1: t("multilingual-item-confirm-discard-keep"),
      defaultButton: 1,
    }) === 0
  );
}

async function onAccept(): Promise<void> {
  // Set before the first await: `busy` rises after the first source check.
  if (accepting || busy || !sourceItem || !draftItem || !io) {
    return;
  }
  accepting = true;
  setSubmissionControls(true);
  try {
    await acceptDraft();
  } finally {
    accepting = false;
    if (!busy) {
      setSubmissionControls(false);
    }
  }
}

async function acceptDraft(): Promise<void> {
  const activeSource = sourceItem;
  const activeDraft = draftItem;
  const activeIO = io;
  const activeSnapshot = sourceSnapshot;
  if (!activeSource || !activeDraft || !activeIO || !activeSnapshot) return;
  clearError();
  getItemEditor()?.blurOpenField();

  const language = normalizeLanguageCode(activeDraft.getField("language"));
  if (!language) {
    showError(t("multilingual-item-error-language"), true);
    focusField("language");
    return;
  }

  if (
    !hasNonLanguageChanges(
      getComparableFields(activeSource),
      getComparableFields(activeDraft),
      getCreatorSnapshots(activeSource),
      getCreatorSnapshots(activeDraft),
    )
  ) {
    showError(t("multilingual-item-error-no-other-changes"), true);
    return;
  }
  try {
    if (
      !(await isSourceSessionCurrent(activeSource, activeSnapshot, activeDraft))
    ) {
      showError(t("multilingual-item-error-source-changed"));
      return;
    }
  } catch (error) {
    ztoolkit.logError(error);
    showError(t("multilingual-item-error-save"));
    return;
  }

  setBusy(true, t("multilingual-item-checking-duplicate"));
  let duplicateItem: Zotero.Item | null;
  try {
    duplicateItem = await activeIO.findDuplicate(activeSource, language);
  } catch (error) {
    ztoolkit.logError(error);
    setBusy(false);
    showError(t("multilingual-item-error-save"));
    return;
  }
  if (
    io !== activeIO ||
    sourceItem !== activeSource ||
    draftItem !== activeDraft
  ) {
    setBusy(false);
    return;
  }
  if (duplicateItem) {
    setBusy(false);
    showDuplicateLanguageError(duplicateItem);
    return;
  }

  showStatus(t("multilingual-item-saving"));
  // Write the canonical tag only now that every check passed: the editor is not
  // re-rendered, so an earlier write made an untouched field look edited.
  activeDraft.setField("language", language);
  const commit = activeIO.commit;
  if (!commit) {
    setBusy(false);
    showError(t("multilingual-item-error-save"));
    return;
  }
  // Snapshot the edits first: a failed commit erases the saved copy.
  const retryDraft = activeDraft.clone(activeSource.libraryID, {
    skipTags: true,
    includeCollections: true,
  });
  prepareDraftItem(retryDraft);

  let failureMessage = t("multilingual-item-error-save");
  try {
    // Persist via `io.commit` so the save survives this window being torn down.
    const outcome = await commit(activeSource, activeDraft, activeSnapshot);
    if (outcome.ok) {
      activeIO.notice = outcome.notice ?? null;
      finish(activeIO, outcome.item);
      closing = true;
      window.close();
      return;
    }
    if ("duplicateItem" in outcome) {
      setBusy(false);
      showDuplicateLanguageError(outcome.duplicateItem);
      return;
    }
    failureMessage = outcome.message;
  } catch (error) {
    // The commit does its own rollback; only relay what failed.
    ztoolkit.logError(error);
  }

  draftItem = retryDraft;
  initItemEditor(retryDraft);
  setBusy(false);
  showError(failureMessage, true);
}

/** The editor element; bridges the markup's `HTMLElement` to its class. */
function getItemEditor(): MultilingualItemEditor | null {
  return document.getElementById(
    "item-editor",
  ) as MultilingualItemEditor | null;
}

function focusField(fieldName: string): void {
  getItemEditor()?.focusField(fieldName);
}

function setBusy(
  isBusy: boolean,
  statusMessage = t("multilingual-item-saving"),
): void {
  busy = isBusy;
  if (isBusy) {
    showStatus(statusMessage);
  } else {
    clearError();
  }
  const editor = getItemEditor();
  if (editor) editor.editable = !isBusy;
  const accept = document.getElementById(
    "accept-button",
  ) as HTMLButtonElement | null;
  const cancel = document.getElementById(
    "cancel-button",
  ) as HTMLButtonElement | null;
  if (accept) accept.disabled = isBusy;
  if (cancel) cancel.disabled = isBusy;
}

function setSubmissionControls(disabled: boolean): void {
  const accept = document.getElementById(
    "accept-button",
  ) as HTMLButtonElement | null;
  const cancel = document.getElementById(
    "cancel-button",
  ) as HTMLButtonElement | null;
  if (accept) accept.disabled = disabled;
  if (cancel) cancel.disabled = disabled;
}

function showDuplicateLanguageError(item: Zotero.Item): void {
  // `showError` renders, so the actions see `duplicateLanguageItem` already.
  duplicateLanguageItem = item;
  showError(t("multilingual-item-error-duplicate-language"), true);
}

function useExistingLanguageItem(): void {
  if (!duplicateLanguageItem || !io) return;
  finish(io, duplicateLanguageItem);
  closing = true;
  window.close();
}

function keepEditingLanguage(): void {
  clearError();
  focusField("language");
}

function onCancel(): void {
  // `accepting` covers the async check; closing then tears down this realm.
  if (busy || accepting) return;
  finish(io, null);
  closing = true;
  window.close();
}

function resetSourceToolbarState(): void {
  const controls = document.getElementById(
    "source-controls",
  ) as HTMLElement | null;
  if (controls) controls.hidden = true;
  for (const id of ["sidebar-toggle", "zoom-in", "zoom-out"]) {
    const button = document.getElementById(id) as HTMLButtonElement | null;
    if (!button) continue;
    button.hidden = true;
    button.disabled = true;
  }
  document
    .getElementById("source-divider-tools")
    ?.toggleAttribute("hidden", true);
  document
    .getElementById("source-divider-pages")
    ?.toggleAttribute("hidden", true);
  const pageInput = document.getElementById(
    "reader-page-index",
  ) as HTMLInputElement | null;
  if (pageInput) {
    pageInput.value = "";
  }
  const pageCount = document.getElementById("reader-page-count");
  if (pageCount) {
    pageCount.textContent = "";
  }
}

function onAcceptShortcut(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    void onAccept();
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.key !== "Escape") {
    return;
  }
  // Esc in a field or the duplicate prompt is theirs; elsewhere it cancels.
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest("editable-text, input, textarea, #source-placeholder")
  ) {
    return;
  }
  event.preventDefault();
  onCancel();
}

function finish(targetIO: IO | null, result: Zotero.Item | null): void {
  if (resolved || !targetIO) return;
  resolved = true;
  targetIO.result = result;
  targetIO.deferred.resolve();
}

function onSplitPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  splitPointerID = event.pointerId;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  event.preventDefault();
}

function onSplitPointerMove(event: PointerEvent): void {
  if (splitPointerID !== event.pointerId) return;
  const workspace = document.getElementById("workspace") as HTMLElement | null;
  if (!workspace) return;
  const rect = workspace.getBoundingClientRect();
  const splitterWidth = 5;
  const editorPaneMinWidth = 336;
  const leftWidth = Math.max(
    300,
    Math.min(
      event.clientX - rect.left,
      rect.width - splitterWidth - editorPaneMinWidth,
    ),
  );
  workspace.style.gridTemplateColumns = `${leftWidth}px ${splitterWidth}px minmax(${editorPaneMinWidth}px, 1fr)`;
}

function onSplitPointerUp(event: PointerEvent): void {
  if (splitPointerID === event.pointerId) {
    splitPointerID = null;
  }
}

/**
 * Drag the sidebar out from the collapsed edge, where the app unmounts its own
 * resizer, so the dialog owns the handle.
 */
function onEdgePointerDown(event: PointerEvent): void {
  if (event.button !== 0 || !sourceReader) return;
  edgeDragPointerId = event.pointerId;
  edgeDragStartX = null;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  event.preventDefault();
}

function onEdgePointerMove(event: PointerEvent): void {
  if (edgeDragPointerId !== event.pointerId) return;
  const internal = sourceReader?._internalReader;
  const viewer = document.getElementById("source-viewer");
  if (!internal || !viewer) return;
  const rect = viewer.getBoundingClientRect();
  const pointerWidth = event.clientX - rect.left;
  if (!internal._state.sidebarOpen) {
    edgeDragStartX ??= pointerWidth;
    if (Math.abs(pointerWidth - edgeDragStartX) < 3) {
      return;
    }
    sourceReader?.toggleSidebar(true);
  }
  const maxWidth = Math.max(
    READER_SIDEBAR_MIN_WIDTH,
    Math.floor(rect.width / 2),
  );
  const width = Math.min(
    Math.max(pointerWidth, READER_SIDEBAR_MIN_WIDTH),
    maxWidth,
  );
  sourceReader?.setSidebarWidth(width);
  previousOpenSidebarWidth = width;
  updateReaderToolbar();
}

function onEdgePointerUp(event: PointerEvent): void {
  if (edgeDragPointerId !== event.pointerId) return;
  edgeDragPointerId = null;
  edgeDragStartX = null;
  const internal = sourceReader?._internalReader;
  if (internal && !internal._state.sidebarOpen) {
    // Treat a plain click on the edge as "reopen the sidebar".
    sourceReader?.toggleSidebar(true);
    updateReaderToolbar();
  }
}
