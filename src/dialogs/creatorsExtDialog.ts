import {
  CREATOR_EXT_FIELDS,
  CREATORS_EXT_KEY,
} from "@banyan/core/items/creatorsExt";
import { replaceExtraFieldBlock } from "@banyan/core/items/extra";
import { switchCreatorNameMode } from "../utils/creatorName";
import {
  buildCreatorsExtWrite,
  carryOverCreatorExtensions,
  hasCreatorListChanged,
  loadCreatorsExt,
  type CreatorsExtDraft,
} from "../utils/creatorsExtDraft";
import {
  getCreatorSnapshots,
  reloadItemContent,
} from "../utils/multilingualDraft";
import { useL10n } from "../utils/locale";
import { unwrapCreatorExtDialogIO } from "../utils/creatorsExtDialogIO";
import type { CreatorExtDialogIO } from "../../typings/creatorsExtDialog";
import type { Creator, CreatorExtField } from "@banyan/core/types/item";
import type { CreatorSnapshot } from "../../typings/multilingualItem";
import type { FluentMessageId } from "../../typings/i10n";
import { createLogger } from "../utils/logger";

const log = createLogger("creators-ext-dialog");

type ZoteroCreatorType = _ZoteroTypes.Item.CreatorJSON["creatorType"];

/** A row being edited: the shared draft shape plus its stable row identity. */
type CreatorDraft = CreatorsExtDraft & {
  /** Stable identity across re-renders, reorders, insertions and removals. */
  id: number;
};

/** Per-field window text; the record forces one entry per extension field. */
const EXTENSION_META: Record<
  CreatorExtField,
  { labelKey: FluentMessageId; placeholderKey: FluentMessageId }
> = {
  role: {
    labelKey: "creators-ext-column-role",
    placeholderKey: "creators-ext-role-placeholder",
  },
  nationality: {
    labelKey: "creators-ext-column-nationality",
    placeholderKey: "creators-ext-nationality-placeholder",
  },
  dynasty: {
    labelKey: "creators-ext-column-dynasty",
    placeholderKey: "creators-ext-dynasty-placeholder",
  },
};

function extensionInputSelector(field: CreatorExtField): string {
  return `.creator-${field}-input`;
}

function emptyExtensions(): Record<CreatorExtField, string> {
  return Object.fromEntries(
    CREATOR_EXT_FIELDS.map((field) => [field, ""]),
  ) as Record<CreatorExtField, string>;
}

type FocusRequest = {
  draftID: number;
  selector: string;
};

const t = useL10n(["creatorsExtDialog.ftl"]);
const DRAG_MIME = "application/x-banyan-creator";

let io: CreatorExtDialogIO | null = null;
let item: Zotero.Item | null = null;
let creatorDrafts: CreatorDraft[] = [];
let nextDraftID = 0;
let initialDateModified = "";
let initialCreators: CreatorSnapshot[] = [];
let orphanLines: string[] = [];
// Same convention as the multilingual window: bumped by every session load, so
// an async load that lost the race cannot write over a newer one.
let reloadGeneration = 0;
let busy = false;
let resolved = false;
let closing = false;
let dragDraftID: number | null = null;
/** Row whose type label opened the shared creator-type menupopup. */
let typeMenuContext: { draft: CreatorDraft; label: HTMLLabelElement } | null =
  null;

window.addEventListener("load", () => void init());
window.addEventListener("unload", () => {
  if (!resolved) {
    resolveDialog();
  }
});
window.addEventListener("close", (event) => {
  if (busy && !closing) {
    event.preventDefault();
    showStatus(t("creators-ext-saving"), true);
  }
});

async function init(): Promise<void> {
  if (document.body) {
    Zotero.UIProperties.registerRoot(document.body);
  }
  bindEvents();

  try {
    io = unwrapCreatorExtDialogIO(window.arguments?.[0]);
    if (!io) {
      throw new Error(t("creators-ext-item-unavailable"));
    }
    item = (await Zotero.Items.getAsync(io.itemID)) || null;
    if (!item || item.deleted || !item.isRegularItem()) {
      throw new Error(t("creators-ext-item-unavailable"));
    }

    await loadSession(item);

    fillCreatorTypeMenu();
    renderRows();

    focusRequestedCreator();
    if (!item.isEditable()) {
      setReadOnly();
    }
  } catch (error) {
    log.error("初始化合作者扩展对话框失败", error);
    showErrorDialog(error instanceof Error ? error.message : String(error));
    setButtonDisabled("save-button", true);
  }
}

function bindEvents(): void {
  document
    .getElementById("cancel-button")
    ?.addEventListener("click", () => finish());
  document
    .getElementById("save-button")
    ?.addEventListener("click", () => void save());
  document
    .getElementById("empty-add-button")
    ?.addEventListener("click", () => addCreator(null));
  bindCreatorTypeMenu();
  document.addEventListener("keydown", (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void save();
    } else if (event.key === "Escape" && !busy) {
      event.preventDefault();
      finish();
    }
  });
}

/**
 * Read the item into the window. A reload passes the drafts on screen as
 * `previous`, which keeps their extension values.
 */
async function loadSession(
  source: Zotero.Item,
  previous: readonly CreatorDraft[] = [],
): Promise<number> {
  const generation = ++reloadGeneration;
  await reloadItemContent(source);
  if (generation !== reloadGeneration) {
    return generation;
  }

  const creators = source.getCreators();
  const creatorRecords = creatorsToJSON(source);
  initialDateModified = source.dateModified;
  initialCreators = getCreatorSnapshots(source);
  const loaded = loadCreatorsExt(
    String(source.getField("extra") || ""),
    creatorRecords,
  );
  orphanLines = loaded.orphanLines;
  for (const issue of loaded.issues) {
    log.warn(issue);
  }
  // Unmatched lines are dropped on save; logging here is their only trace.
  if (orphanLines.length) {
    log.warn(
      `${orphanLines.length} record(s) match no creator and will be dropped on save: ${orphanLines.join(" ")}`,
    );
  }
  const carried = carryOverCreatorExtensions(previous, creatorRecords);

  creatorDrafts = creators.map((creator, index) => {
    const creatorType = Zotero.CreatorTypes.getName(creator.creatorTypeID);
    if (!isZoteroCreatorType(creatorType)) {
      throw new Error(
        t("creators-ext-invalid-creator-type", {
          args: { index: index + 1 },
        }),
      );
    }
    // A carried entry is authoritative, including an emptied field; without
    // one, the record stored on the item is.
    const ext = carried.get(index) ?? loaded.bindings.get(index);
    return {
      id: nextDraftID++,
      creatorType,
      fieldMode: creator.fieldMode,
      firstName: creator.firstName,
      lastName: creator.lastName,
      ...emptyExtensions(),
      ...ext,
    };
  });

  return generation;
}

function creatorsToJSON(sourceItem: Zotero.Item): Creator[] {
  return sourceItem.getCreators().map((creator) => {
    const creatorTypeName = Zotero.CreatorTypes.getName(creator.creatorTypeID);
    if (!isZoteroCreatorType(creatorTypeName)) {
      throw new Error(`Unknown creator type '${creatorTypeName}'`);
    }
    return creator.fieldMode === 1
      ? { creatorType: creatorTypeName, name: creator.lastName }
      : {
          creatorType: creatorTypeName,
          firstName: creator.firstName,
          lastName: creator.lastName,
        };
  });
}

function renderRows(focus?: FocusRequest): void {
  const container = document.getElementById("creator-rows");
  if (!container) {
    throw new Error("Creator rows container is unavailable");
  }
  container.replaceChildren(
    ...creatorDrafts.map((draft, index) => createCreatorRow(draft, index)),
  );
  scheduleLayout(nameInputs(container));
  updateEmptyState();
  if (focus) {
    const row = container.querySelector<HTMLElement>(
      `.creator-row[data-draft-id="${focus.draftID}"]`,
    );
    row?.querySelector<HTMLElement>(focus.selector)?.focus();
  }
}

function updateEmptyState(): void {
  document
    .getElementById("empty-state")
    ?.toggleAttribute("hidden", creatorDrafts.length > 0);
}

function createCreatorRow(draft: CreatorDraft, index: number): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "creator-row meta-row";
  row.dataset.draftId = String(draft.id);

  // Grippy: hold to make the row draggable, mirroring itemBox.addCreatorRow()
  const grippy = document.createXULElement("toolbarbutton");
  grippy.className = "zotero-clicky zotero-clicky-grippy creator-grippy";
  grippy.setAttribute("tabindex", "-1");
  grippy.setAttribute("tooltiptext", t("creators-ext-drag-reorder"));
  grippy.setAttribute("aria-label", t("creators-ext-drag-reorder"));
  grippy.addEventListener("mousedown", () => {
    if (item?.isEditable()) {
      row.setAttribute("draggable", "true");
    }
  });
  grippy.addEventListener("mouseup", () => {
    row.removeAttribute("draggable");
  });
  row.appendChild(grippy);

  const typeCell = document.createElement("div");
  typeCell.className = "creator-type-cell";
  typeCell.appendChild(createTypeLabel(draft));
  row.appendChild(typeCell);

  const nameCell = document.createElement("div");
  nameCell.className = "creator-name-box";
  const lastName = createNameInput(draft, index, "lastName");
  const firstName = createNameInput(draft, index, "firstName");
  firstName.hidden = draft.fieldMode === 1;
  nameCell.append(lastName, firstName);
  row.appendChild(nameCell);

  for (const field of CREATOR_EXT_FIELDS) {
    const meta = EXTENSION_META[field];
    const input = createExtensionInput(
      field,
      draft[field],
      t(meta.placeholderKey),
    );
    input.addEventListener("input", () => {
      draft[field] = input.value;
    });
    row.appendChild(input);
  }

  const controls = document.createElement("div");
  controls.className = "creator-controls";
  controls.append(
    createModeButton(draft, lastName, firstName),
    createSwapButton(draft, lastName, firstName),
    createRowButton("minus", Zotero.getString("general.delete"), () =>
      removeCreator(draft.id),
    ),
    createRowButton("plus", Zotero.getString("general.create"), () =>
      addCreator(draft.id),
    ),
  );
  row.appendChild(controls);

  bindDragHandlers(row);
  return row;
}

function creatorTypeMenu(): XULMenuPopupElement {
  const menu = document.getElementById("creator-type-menu");
  if (!menu) {
    throw new Error("Creator type menu is unavailable");
  }
  return menu as unknown as XULMenuPopupElement;
}

/**
 * One shared menupopup of the creator types valid for the item type, as in
 * itemBox; the row being edited lives in `typeMenuContext`.
 */
function fillCreatorTypeMenu(): void {
  const menu = creatorTypeMenu();
  menu.replaceChildren();
  for (const type of Zotero.CreatorTypes.getTypesForItemType(
    item!.itemTypeID,
  )) {
    const menuitem = document.createXULElement("menuitem");
    menuitem.setAttribute(
      "label",
      Zotero.CreatorTypes.getLocalizedString(type.name),
    );
    menuitem.setAttribute("typeid", String(type.id));
    menu.appendChild(menuitem);
  }
}

function bindCreatorTypeMenu(): void {
  const menu = creatorTypeMenu();
  menu.addEventListener("command", (event: Event) => {
    const typeID = (event.target as XULMenuItemElement | null)?.getAttribute(
      "typeid",
    );
    if (!typeID || !typeMenuContext) {
      return;
    }
    const name = Zotero.CreatorTypes.getName(parseInt(typeID));
    if (!isZoteroCreatorType(name)) {
      return;
    }
    typeMenuContext.draft.creatorType = name;
    typeMenuContext.label.textContent =
      Zotero.CreatorTypes.getLocalizedString(name);
    // A longer (or shorter) type label moves the columns that follow it.
    applyColumnLayout();
  });
  menu.addEventListener("popuphidden", () => {
    // Matches itemBox: blur after a mouse-opened menu so hover icons hide.
    if (menu.getAttribute("blur-on-hidden")) {
      (document.activeElement as HTMLElement | null)?.blur();
      menu.removeAttribute("blur-on-hidden");
    }
  });
}

/**
 * Creator type picker modeled on itemBox: a clicky label with a chevron
 * dropmarker that opens the shared menupopup, instead of an HTML <select>.
 */
function createTypeLabel(draft: CreatorDraft): HTMLDivElement {
  const labelWrapper = document.createElement("div");
  labelWrapper.className = "creator-type-label keyboard-clickable";
  labelWrapper.setAttribute("tabindex", "0");
  labelWrapper.setAttribute("role", "button");

  if (item?.isEditable()) {
    labelWrapper.classList.add("zotero-clicky");
    const dropmarker = document.createElement("span");
    dropmarker.className = "creator-type-dropmarker";
    labelWrapper.appendChild(dropmarker);

    const openMenu = (viaMouse: boolean): void => {
      const inner = labelWrapper.querySelector<HTMLLabelElement>(
        ".creator-type-label-inner",
      );
      if (!inner) {
        return;
      }
      typeMenuContext = { draft, label: inner };
      creatorTypeMenu().openPopup(labelWrapper);
      if (viaMouse) {
        creatorTypeMenu().setAttribute("blur-on-hidden", "true");
      }
    };
    // itemBox: a mouse click carries coordinates, a keyboard-driven click
    // passes 0, 0.
    labelWrapper.addEventListener("click", (event: MouseEvent) => {
      openMenu(event.x !== 0 && event.y !== 0);
    });
    labelWrapper.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openMenu(false);
      }
    });
  }

  const label = document.createElement("label");
  label.className = "creator-type-label-inner";
  label.textContent = Zotero.CreatorTypes.getLocalizedString(draft.creatorType);
  labelWrapper.appendChild(label);
  return labelWrapper;
}

function createNameInput(
  draft: CreatorDraft,
  index: number,
  namePart: "firstName" | "lastName",
): _ZoteroTypes.EditableText {
  const input = createTextField(
    `value ${namePart === "lastName" ? "creator-last-name" : "creator-first-name"}`,
    namePart === "lastName" ? draft.lastName : draft.firstName,
  );
  input.setAttribute("fieldname", `creator-${index}-${namePart}`);
  updateNameInputMode(input, namePart, draft.fieldMode);
  input.addEventListener("input", () => {
    if (namePart === "lastName") {
      draft.lastName = input.value;
    } else {
      draft.firstName = input.value;
    }
  });
  input.addEventListener("input", input.sizeToContent);
  input.addEventListener("blur", input.sizeToContent);
  return input;
}

function createExtensionInput(
  field: CreatorExtField,
  value: string,
  placeholder: string,
): _ZoteroTypes.EditableText {
  const input = createTextField(
    `value creator-extension-input creator-${field}-input`,
    value,
    placeholder,
  );
  input.setAttribute("aria-label", t(EXTENSION_META[field].labelKey));
  input.addEventListener("blur", () => applyColumnLayout());
  return input;
}

/** A single-line field, the shape itemBox uses for every value it edits. */
function createTextField(
  className: string,
  value: string,
  placeholder = "",
): _ZoteroTypes.EditableText {
  const input = document.createXULElement("editable-text");
  input.className = className;
  input.setAttribute("tight", "true");
  input.setAttribute("nowrap", "true");
  input.setAttribute("dir", "auto");
  input.value = value;
  input.placeholder = placeholder;
  return input;
}

function createModeButton(
  draft: CreatorDraft,
  lastName: _ZoteroTypes.EditableText,
  firstName: _ZoteroTypes.EditableText,
): XULToolBarButtonElement {
  const modeButton = document.createXULElement("toolbarbutton");
  modeButton.className =
    "zotero-clicky zotero-clicky-switch-type creator-mode-button";
  // XUL toolbarbuttons need an explicit tabindex to be reachable by Tab
  // (itemBox._ensureButtonsFocusable); items are never disabled, so the mode
  // toggle stays reachable in both name modes.
  modeButton.setAttribute("tabindex", "0");
  updateModeButton(modeButton, draft.fieldMode);
  modeButton.addEventListener("command", () => {
    syncNameDraft(draft, lastName, firstName);
    const next = switchCreatorNameMode(
      {
        fieldMode: draft.fieldMode,
        firstName: draft.firstName,
        lastName: draft.lastName,
      },
      draft.fieldMode === 1 ? 0 : 1,
    );
    draft.fieldMode = next.fieldMode;
    draft.firstName = next.firstName;
    draft.lastName = next.lastName;
    lastName.value = next.lastName;
    firstName.value = next.firstName;
    updateNameInputMode(lastName, "lastName", next.fieldMode);
    updateNameInputMode(firstName, "firstName", next.fieldMode);
    firstName.hidden = next.fieldMode === 1;
    const swapButton =
      modeButton.parentElement?.querySelector<HTMLButtonElement>(
        ".creator-swap-button",
      );
    if (swapButton) {
      swapButton.disabled = next.fieldMode === 1;
    }
    updateModeButton(modeButton, next.fieldMode);
    // The single-field placeholder is longer, so the name column is re-measured.
    scheduleLayout([lastName, firstName]);
    modeButton.focus();
  });
  return modeButton;
}

function createSwapButton(
  draft: CreatorDraft,
  lastName: _ZoteroTypes.EditableText,
  firstName: _ZoteroTypes.EditableText,
): HTMLButtonElement {
  const swapButton = document.createElement("button");
  swapButton.type = "button";
  swapButton.className = "creator-swap-button zotero-clicky";
  swapButton.textContent = "⇄";
  swapButton.setAttribute("aria-label", t("creators-ext-swap-names"));
  swapButton.title = t("creators-ext-swap-names");
  swapButton.disabled = draft.fieldMode === 1;
  swapButton.addEventListener("click", () => {
    syncNameDraft(draft, lastName, firstName);
    [draft.lastName, draft.firstName] = [draft.firstName, draft.lastName];
    lastName.value = draft.lastName;
    firstName.value = draft.firstName;
    firstName.focus();
  });
  return swapButton;
}

function createRowButton(
  kind: "minus" | "plus",
  tooltip: string,
  onCommand: () => void,
): XULToolBarButtonElement {
  const button = document.createXULElement("toolbarbutton");
  button.className = `zotero-clicky zotero-clicky-${kind}`;
  button.setAttribute("tabindex", "0");
  button.setAttribute("tooltiptext", tooltip);
  button.setAttribute("aria-label", tooltip);
  button.addEventListener("command", onCommand);
  return button;
}

/** Gecko types drag events as plain `Event`; this is the only cast needed. */
function addDragListener(
  row: HTMLElement,
  type: "dragstart" | "dragover" | "drop" | "dragend",
  handler: (event: DragEvent) => void,
): void {
  row.addEventListener(type, (event) => handler(event as DragEvent));
}

/**
 * Drag-drop reordering as in itemBox: the dragged row stays in the DOM as an
 * invisible placeholder and moves under the pointer, so the DOM order on drop
 * is already the target order.
 */
function bindDragHandlers(row: HTMLDivElement): void {
  addDragListener(row, "dragstart", (event) => {
    if (row.getAttribute("draggable") !== "true" || !event.dataTransfer) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    dragDraftID = Number(row.dataset.draftId);
    // Firefox requires data to be set for the drag to start at all.
    event.dataTransfer.setData(DRAG_MIME, String(dragDraftID));
    event.dataTransfer.setData("text/plain", String(dragDraftID));
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setDragImage(row, 15, 15);
    // Hide after the drag image is generated, turning the row into a gap.
    setTimeout(() => row.classList.add("drag-hidden-creator"));
  });

  addDragListener(row, "dragover", (event) => {
    if (dragDraftID === null) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    const container = row.parentElement;
    const placeholder = container?.querySelector<HTMLElement>(
      ".creator-row.drag-hidden-creator",
    );
    if (!container || !placeholder || placeholder === row) {
      return;
    }
    const rect = row.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    container.insertBefore(placeholder, before ? row : row.nextSibling);
  });

  addDragListener(row, "drop", (event) => {
    if (dragDraftID === null) {
      return;
    }
    event.preventDefault();
    syncAllDraftsFromDOM();
    reorderDraftsFromDOM();
    const movedID = dragDraftID;
    dragDraftID = null;
    renderRows({ draftID: movedID, selector: ".creator-grippy" });
  });

  addDragListener(row, "dragend", () => {
    if (dragDraftID === null) {
      return;
    }
    // No drop happened: dragover may have moved the hidden placeholder, so
    // re-render from the unchanged draft order (as itemBox force-renders).
    dragDraftID = null;
    renderRows();
  });
}

function reorderDraftsFromDOM(): void {
  const rows = creatorRowElements();
  const byID = new Map(creatorDrafts.map((draft) => [String(draft.id), draft]));
  const ordered: CreatorDraft[] = [];
  for (const row of rows) {
    const draft = row.dataset.draftId
      ? byID.get(row.dataset.draftId)
      : undefined;
    if (draft) {
      ordered.push(draft);
    }
  }
  if (ordered.length === creatorDrafts.length) {
    creatorDrafts = ordered;
  }
}

function addCreator(afterID: number | null): void {
  if (!item?.isEditable() || busy) {
    return;
  }
  syncAllDraftsFromDOM();
  const position =
    afterID === null
      ? creatorDrafts.length
      : creatorDrafts.findIndex((draft) => draft.id === afterID) + 1;
  const draft: CreatorDraft = {
    id: nextDraftID++,
    creatorType:
      creatorDrafts[position - 1]?.creatorType ?? defaultCreatorType(),
    // Read the native default for new rows, but never write the pref.
    fieldMode: Number(Zotero.Prefs.get("lastCreatorFieldMode")) === 1 ? 1 : 0,
    firstName: "",
    lastName: "",
    ...emptyExtensions(),
  };
  creatorDrafts.splice(position, 0, draft);
  renderRows({ draftID: draft.id, selector: ".creator-last-name" });
}

function removeCreator(id: number): void {
  if (!item?.isEditable() || busy) {
    return;
  }
  syncAllDraftsFromDOM();
  const position = creatorDrafts.findIndex((draft) => draft.id === id);
  if (position < 0) {
    return;
  }
  creatorDrafts.splice(position, 1);
  const focusID =
    creatorDrafts[position]?.id ?? creatorDrafts[position - 1]?.id;
  renderRows(
    focusID === undefined
      ? undefined
      : { draftID: focusID, selector: ".zotero-clicky-minus" },
  );
}

function defaultCreatorType(): ZoteroCreatorType {
  const first = item
    ? Zotero.CreatorTypes.getTypesForItemType(item.itemTypeID)[0]?.name
    : undefined;
  return isZoteroCreatorType(first) ? first : "author";
}

function syncNameDraft(
  draft: CreatorDraft,
  lastName: _ZoteroTypes.EditableText,
  firstName: _ZoteroTypes.EditableText,
): void {
  draft.lastName = lastName.value;
  draft.firstName = draft.fieldMode === 1 ? "" : firstName.value;
}

function updateNameInputMode(
  input: _ZoteroTypes.EditableText,
  namePart: "firstName" | "lastName",
  fieldMode: 0 | 1,
): void {
  input.setAttribute("fieldMode", String(fieldMode));
  input.placeholder = `(${Zotero.getString(
    namePart === "firstName"
      ? "pane.item.defaultFirstName"
      : fieldMode === 1
        ? "pane.item.defaultFullName"
        : "pane.item.defaultLastName",
  )})`;
}

function isEditableText(
  element: unknown,
): element is _ZoteroTypes.EditableText {
  return (
    typeof element === "object" &&
    element !== null &&
    "sizeToContent" in element
  );
}

/**
 * Size the fields to their content, then re-measure the columns that their
 * placeholders and values call for; both need them to be in the DOM.
 */
function scheduleLayout(inputs: readonly _ZoteroTypes.EditableText[]): void {
  setTimeout(() => {
    for (const input of inputs) {
      input.sizeToContent();
    }
    applyColumnLayout();
  });
}

/** The name fields inside `container`, in document order. */
function nameInputs(container: Element): _ZoteroTypes.EditableText[] {
  return Array.from(
    container.querySelectorAll(".creator-last-name, .creator-first-name"),
  ).filter(isEditableText);
}

/**
 * Lay the rows out on shared columns, so they line up even when the creator
 * types differ in length, and floor every field at its placeholder, so the
 * narrowest allowed window still shows each one in full. Only the name box
 * gives way; the window's own floor follows, since the list never scrolls
 * sideways.
 */
function applyColumnLayout(): void {
  const root = dialogRoot();
  if (!root) {
    return;
  }
  const rows = creatorRowElements();
  if (!rows.length) {
    root.style.minWidth = "";
    return;
  }

  applyTypeColumn(rows);
  applyExtensionColumns(rows);
  applyNameColumns(rows);

  // Rows can differ in name mode, so the widest one decides.
  const floor = Math.max(...rows.map(rowFloorWidth));
  root.style.minWidth = `${floor}px`;
  growToFit(root, floor);
}

/**
 * Grow a window restored narrower than its columns need: the size is persisted
 * per user, so it can predate them.
 */
function growToFit(root: HTMLElement, floor: number): void {
  const width = root.getBoundingClientRect().width;
  if (!width || width >= floor) {
    return;
  }
  window.resizeTo(
    floor + Math.max(0, window.outerWidth - width),
    window.outerHeight,
  );
}

/** One width for every row's creator-type label, so the fields line up. */
function applyTypeColumn(rows: readonly HTMLElement[]): void {
  const cells = rows
    .map((row) => row.querySelector(".creator-type-cell"))
    .filter((cell): cell is HTMLElement => cell !== null);
  for (const cell of cells) {
    cell.style.minWidth = "";
  }
  const width = Math.max(
    0,
    ...cells.map((cell) => cell.getBoundingClientRect().width),
  );
  for (const cell of cells) {
    cell.style.minWidth = `${Math.ceil(width)}px`;
  }
}

/** One width per extension column, spanning every row. */
function applyExtensionColumns(rows: readonly HTMLElement[]): void {
  for (const field of CREATOR_EXT_FIELDS) {
    const inputs = rows
      .map((row) =>
        row.querySelector<_ZoteroTypes.EditableText>(
          extensionInputSelector(field),
        ),
      )
      .filter(isEditableText);
    if (!inputs.length) {
      continue;
    }
    const width = Math.max(
      // The placeholder is the same for the whole column, so it is measured
      // once; every row's value is measured because the longest one wins.
      contentWidth(inputs[0], inputs[0].placeholder),
      ...inputs.map((input) => contentWidth(input, input.value)),
    );
    for (const input of inputs) {
      // An explicit width (with a matching min-width) keeps the column stable:
      // sizeToContent()'s max-width alone would let the flex layout squeeze
      // each row by a different amount.
      input.style.width = `${Math.ceil(width)}px`;
      input.style.minWidth = `${Math.ceil(width)}px`;
    }
  }
}

/**
 * Size the name columns to the text each field shows — its value, or the
 * placeholder while it is empty, as `sizeToContent()` does. Flooring a field at
 * the longer of the two would override that max-width and leave the comma
 * sitting away from a short last name, so only the box takes the sum: it is
 * what holds the window open wide enough to show every placeholder in full.
 */
function applyNameColumns(rows: readonly HTMLElement[]): void {
  for (const row of rows) {
    const box = row.querySelector<HTMLElement>(".creator-name-box");
    if (!box) {
      continue;
    }
    const inputs = Array.from(box.querySelectorAll("editable-text")).filter(
      isEditableText,
    );
    let floor = 0;
    for (const input of inputs) {
      if (input.hidden) {
        input.style.minWidth = "";
        continue;
      }
      const width = contentWidth(input, input.value || input.placeholder);
      // Rounded down, so the field's floor stays under its max-width.
      input.style.minWidth = `${Math.floor(width)}px`;
      floor += Math.ceil(width);
    }
    if (inputs.length > 1) {
      floor +=
        Number.parseFloat(
          window.getComputedStyle?.(inputs[0])?.marginInlineEnd ?? "",
        ) || 0;
    }
    box.style.minWidth = `${Math.ceil(floor)}px`;
  }
}

/** The dialog's root element, where the window's own floor is declared. */
function dialogRoot(): HTMLElement | null {
  return (document.documentElement as HTMLElement | null) ?? null;
}

/** Width of `text` in `input`'s field, measured through a hidden stand-in. */
function contentWidth(input: _ZoteroTypes.EditableText, text: string): number {
  const probe = createExtensionInputFrom(input, text);
  const host =
    input.parentElement ?? (document.body as HTMLElement | null) ?? null;
  if (!host) {
    return 0;
  }
  host.appendChild(probe);
  probe.sizeToContent();
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}

/** A hidden copy of `input` showing `text`, for measurement only. */
function createExtensionInputFrom(
  input: _ZoteroTypes.EditableText,
  text: string,
): _ZoteroTypes.EditableText {
  const probe = createTextField(input.className, text, text);
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.minWidth = "0";
  return probe;
}

/** Narrowest width one row can be laid out in: what the window must keep. */
function rowFloorWidth(row: HTMLElement): number {
  const scroll = document.getElementById("creators-scroll");
  const gap =
    Number.parseFloat(window.getComputedStyle?.(row)?.columnGap ?? "") || 0;
  const children = Array.from(row.children);
  let fixed = gap * Math.max(0, children.length - 1);

  for (const child of children) {
    const element = child as HTMLElement;
    // A declared floor is the element's own limit; the current width stands in
    // for the rest (the buttons), which are never squeezed.
    const floor = floorOf(element);
    fixed += floor || element.getBoundingClientRect().width;
  }

  if (scroll) {
    const scrollStyle = window.getComputedStyle?.(scroll) ?? null;
    fixed +=
      (Number.parseFloat(scrollStyle?.paddingLeft ?? "") || 0) +
      (Number.parseFloat(scrollStyle?.paddingRight ?? "") || 0);
  }
  // 2px for fractional rounding, as the citation dialog allows itself.
  return fixed + 2;
}

/** An element's declared `min-width` in pixels, or 0 when it has none. */
function floorOf(element: HTMLElement): number {
  const raw = window.getComputedStyle?.(element)?.minWidth ?? "";
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}

function updateModeButton(
  button: XULToolBarButtonElement,
  fieldMode: 0 | 1,
): void {
  button.setAttribute("type", fieldMode === 1 ? "single" : "dual");
  const tooltip = Zotero.getString(
    fieldMode === 1
      ? "pane.item.switchFieldMode.two"
      : "pane.item.switchFieldMode.one",
  );
  button.setAttribute("tooltiptext", tooltip);
  button.setAttribute("aria-label", tooltip);
}

/**
 * Gecko's NodeListOf indexes as `any`; copy into a real array so row element
 * types survive.
 */
function creatorRowElements(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("#creator-rows .creator-row"),
  );
}

function focusRequestedCreator(): void {
  if (io?.focusCreatorIndex === undefined) {
    return;
  }
  const row = creatorRowElements()[io.focusCreatorIndex];
  row?.scrollIntoView({ block: "nearest" });
  row?.querySelector<_ZoteroTypes.EditableText>(".creator-last-name")?.focus();
}

/** An error to acknowledge; Zotero reports edit outcomes with a dialog too. */
function showErrorDialog(message: string): void {
  Zotero.Prompt.confirm({
    window,
    title: t("creators-ext-error-title"),
    text: message,
    button0: Zotero.Prompt.BUTTON_TITLE_OK,
  });
}

function setReadOnly(): void {
  showStatus(t("creators-ext-read-only"), true);
  for (const input of document.querySelectorAll(
    ".creator-extension-input, .creator-last-name, .creator-first-name",
  )) {
    (input as _ZoteroTypes.EditableText).readOnly = true;
  }
  for (const button of document.querySelectorAll(
    ".creator-mode-button, .creator-swap-button, .creator-grippy, " +
      ".zotero-clicky-minus, .zotero-clicky-plus, #empty-add-button",
  )) {
    (button as HTMLButtonElement | XULToolBarButtonElement).disabled = true;
  }
  setButtonDisabled("save-button", true);
}

/** Disable a footer button by id, when the document has it. */
function setButtonDisabled(id: string, value: boolean): void {
  const button = document.getElementById(id) as HTMLButtonElement | null;
  if (button) {
    button.disabled = value;
  }
}

async function save(): Promise<void> {
  if (busy || !item) {
    return;
  }
  if (!item.isEditable()) {
    showErrorDialog(t("creators-ext-read-only"));
    return;
  }

  busy = true;
  setSaveBusy(true);
  try {
    syncAllDraftsFromDOM();
    const latest = await Zotero.Items.getAsync(item.id);
    if (!latest || latest.deleted) {
      showErrorDialog(t("creators-ext-item-unavailable"));
      return;
    }
    if (!latest.isEditable()) {
      showErrorDialog(t("creators-ext-read-only"));
      return;
    }
    // Read the stored data rather than trusting whatever this item instance
    // already holds; the multilingual window does the same before comparing.
    await reloadItemContent(latest);
    if (latest.deleted) {
      showErrorDialog(t("creators-ext-item-unavailable"));
      return;
    }
    // A list of the same length that changed elsewhere is still a conflict:
    // saving the drafts would revert it. Reload in place instead of asking for
    // a manual close and reopen.
    if (hasCreatorListChanged(initialCreators, getCreatorSnapshots(latest))) {
      const reload = Zotero.Prompt.confirm({
        window,
        title: t("creators-ext-conflict-title"),
        text: t("creators-ext-conflict-creators-changed"),
        // Destructive choice on button0, safe one on button1: Esc and the
        // close button return the latter.
        button0: t("creators-ext-reload"),
        button1: t("creators-ext-cancel"),
        defaultButton: 1,
      });
      if (reload !== 0) {
        return;
      }
      item = latest;
      const generation = await loadSession(latest, creatorDrafts);
      if (generation !== reloadGeneration) {
        return;
      }
      if (!latest.isEditable()) {
        showErrorDialog(t("creators-ext-read-only"));
        return;
      }
      fillCreatorTypeMenu();
      renderRows();
    }
    if (latest.dateModified !== initialDateModified) {
      const overwrite = Zotero.Prompt.confirm({
        window,
        title: t("creators-ext-conflict-title"),
        text: t("creators-ext-conflict-message"),
        button0: t("creators-ext-conflict-overwrite"),
        button1: t("creators-ext-cancel"),
      });
      if (overwrite !== 0) {
        return;
      }
    }

    const { creators, lines } = buildCreatorsExtWrite(creatorDrafts);
    latest.setCreators(creators);
    const extra = String(latest.getField("extra") || "");
    latest.setField(
      "extra",
      replaceExtraFieldBlock(extra, CREATORS_EXT_KEY, lines),
    );
    // Creators and extra are staged in one transaction, so one undo entry.
    await latest.saveTx({ undoAction: "undo-action-edit-creator" });
    finish();
  } catch (error) {
    log.error("保存合作者扩展信息失败", error);
    showErrorDialog(
      error instanceof Error ? error.message : t("creators-ext-save-failed"),
    );
  } finally {
    if (!resolved) {
      busy = false;
      setSaveBusy(false);
    }
  }
}

function setSaveBusy(value: boolean): void {
  setButtonDisabled("save-button", value);
  setButtonDisabled("cancel-button", value);
}

function syncAllDraftsFromDOM(): void {
  const rows = creatorRowElements();
  const byID = new Map(creatorDrafts.map((draft) => [String(draft.id), draft]));
  for (const row of rows) {
    const draft = row.dataset.draftId
      ? byID.get(row.dataset.draftId)
      : undefined;
    if (!draft) {
      continue;
    }
    const position = creatorDrafts.indexOf(draft) + 1;
    const lastName =
      row.querySelector<_ZoteroTypes.EditableText>(".creator-last-name");
    const firstName = row.querySelector<_ZoteroTypes.EditableText>(
      ".creator-first-name",
    );
    const extensions = new Map<CreatorExtField, _ZoteroTypes.EditableText>();
    for (const field of CREATOR_EXT_FIELDS) {
      const input = row.querySelector<_ZoteroTypes.EditableText>(
        extensionInputSelector(field),
      );
      if (input) {
        extensions.set(field, input);
      }
    }
    if (
      !lastName ||
      !firstName ||
      extensions.size !== CREATOR_EXT_FIELDS.length
    ) {
      throw new Error(
        t("creators-ext-row-unavailable", { args: { index: position } }),
      );
    }

    syncNameDraft(draft, lastName, firstName);
    for (const [field, input] of extensions) {
      draft[field] = input.value;
    }
  }
}

function isZoteroCreatorType(value: unknown): value is ZoteroCreatorType {
  return (
    typeof value === "string" && Zotero.CreatorTypes.getID(value) !== false
  );
}

function showStatus(message: string, isError = false): void {
  const status = document.getElementById("dialog-status") as HTMLElement | null;
  if (!status) {
    return;
  }
  status.textContent = message;
  status.hidden = !message;
  status.setAttribute("role", isError ? "alert" : "status");
  status.classList.toggle("error", isError);
}

function finish(): void {
  if (resolved) {
    return;
  }
  resolveDialog();
  closing = true;
  window.close();
}

function resolveDialog(): void {
  if (resolved) {
    return;
  }
  resolved = true;
  io?.deferred.resolve();
}
