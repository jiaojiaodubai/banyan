import {
  CREATOR_EXT_FIELDS,
  CREATORS_EXT_KEY,
} from "@banyan/core/items/creatorsExt";
import { replaceExtraFieldBlock } from "@banyan/core/items/extra";
import type { Creator, CreatorExtField } from "@banyan/core/types/item";
import { switchCreatorNameMode } from "../utils/creatorName";
import {
  buildCreatorsExtWrite,
  emptyCreatorExtensions,
  loadCreatorsExt,
  type CreatorsExtDraft,
  type CreatorsExtWrite,
} from "../utils/creatorsExtDraft";
import { useL10n } from "../utils/locale";
import {
  populateEditContextMenu,
  textInputFromEvent,
} from "../utils/editContextMenu";
import type { FluentMessageId } from "../../typings/i10n";
import { createLogger } from "../utils/logger";

const log = createLogger("creator-editor");

type ZoteroCreatorType = _ZoteroTypes.Item.CreatorJSON["creatorType"];

/** A row being edited: the shared draft shape plus its stable row identity. */
type CreatorDraft = CreatorsExtDraft & {
  /** Stable identity across re-renders, reorders, insertions and removals. */
  id: number;
};

type FocusRequest = {
  draftID: number;
  selector: string;
};

const EXTENSION_META: Record<
  CreatorExtField,
  { labelKey: FluentMessageId; placeholderKey: FluentMessageId }
> = {
  role: {
    labelKey: "item-editor-column-role",
    placeholderKey: "item-editor-role-placeholder",
  },
  nationality: {
    labelKey: "item-editor-column-nationality",
    placeholderKey: "item-editor-nationality-placeholder",
  },
  dynasty: {
    labelKey: "item-editor-column-dynasty",
    placeholderKey: "item-editor-dynasty-placeholder",
  },
};

const t = useL10n(["itemEditor.ftl"]);
const DRAG_MIME = "application/x-banyan-creator";

function extensionInputSelector(field: CreatorExtField): string {
  return `.creator-${field}-input`;
}

/**
 * Editable creator rows with CreatorExt's add/remove/reorder/type/name-mode
 * affordances. It owns only the rows and drafts; window save/conflict logic
 * belongs to the item editor dialog.
 */
export class CreatorEditor extends XULElement {
  private _item: Zotero.Item | null = null;
  private _editable = true;
  private _dirty = false;
  private _drafts: CreatorDraft[] = [];
  private _nextDraftID = 0;
  private _rows: HTMLDivElement | null = null;
  private _scroll: HTMLDivElement | null = null;
  private _typeMenu: XULMenuPopupElement | null = null;
  private _contextMenu: XULMenuPopupElement | null = null;
  private _contextDraftID: number | null = null;
  private _typeMenuContext: {
    draft: CreatorDraft;
    label: HTMLLabelElement;
  } | null = null;
  private _dragDraftID: number | null = null;

  get item(): Zotero.Item | null {
    return this._item;
  }

  /** Natural width of the widest creator row, without the row fill. */
  get contentMinWidth(): number {
    const labelWidth = Number.parseFloat(
      window
        .getComputedStyle?.(this)
        ?.getPropertyValue("--item-editor-label-width") ?? "",
    );
    const label =
      Number.isFinite(labelWidth) && labelWidth > 0 ? labelWidth : 100;
    let content = 0;
    for (const row of this.creatorRowElements()) {
      const data = row.querySelector<HTMLElement>(".creator-data-cell");
      if (!data) continue;
      let rowWidth = 0;
      const nameBox = data.querySelector<HTMLElement>(".creator-name-box");
      if (nameBox) {
        let visibleNames = 0;
        for (const input of nameBox.querySelectorAll("editable-text")) {
          if ((input as HTMLElement).hidden) continue;
          rowWidth += (input as HTMLElement).getBoundingClientRect().width;
          visibleNames++;
        }
        if (visibleNames > 1) rowWidth += 4;
      }
      for (const input of data.querySelectorAll(".creator-extension-input")) {
        rowWidth += (input as HTMLElement).getBoundingClientRect().width;
      }
      const controls = data.querySelector<HTMLElement>(".creator-controls");
      if (controls) rowWidth += controls.getBoundingClientRect().width;
      rowWidth += Math.max(0, data.children.length - 1) * 4;
      content = Math.max(content, rowWidth);
    }
    return Math.ceil(label + 8 + content + 16);
  }

  get dirty(): boolean {
    return this._dirty;
  }

  get editable(): boolean {
    return this._editable;
  }

  set editable(value: boolean) {
    if (this._editable === value) return;
    this._editable = value;
    this.renderRows();
  }

  connectedCallback(): void {
    this.style.width = "100%";
    const scroll = document.createElement("div");
    scroll.className = "creator-scroll";
    const rows = document.createElement("div");
    rows.className = "creator-rows";

    const menu = document.createXULElement("menupopup");
    menu.className = "creator-type-menu";
    menu.addEventListener("command", (event: Event) =>
      this.onTypeCommand(event),
    );

    const contextMenu = document.createXULElement("menupopup");
    contextMenu.className = "creator-context-menu";

    scroll.append(rows);
    this.append(menu, contextMenu, scroll);
    document.addEventListener("contextmenu", this.onContextMenu, true);
    this._scroll = scroll;
    this._rows = rows;
    this._typeMenu = menu as unknown as XULMenuPopupElement;
    this._contextMenu = contextMenu as unknown as XULMenuPopupElement;
    this.renderRows();
  }

  disconnectedCallback(): void {
    document.removeEventListener("contextmenu", this.onContextMenu, true);
  }

  /** Point the editor at a fresh item; drafts are reloaded from its extra. */
  configure(item: Zotero.Item, editable: boolean): void {
    this._item = item;
    this._editable = editable;
    this.loadDrafts(item);
    this.fillCreatorTypeMenu();
    this.renderRows();
  }

  focusCreator(index: number): void {
    const row = this.creatorRowElements()[index];
    row?.scrollIntoView({ block: "nearest" });
    row
      ?.querySelector<_ZoteroTypes.EditableText>(".creator-last-name")
      ?.focus();
  }

  blurOpenField(): boolean {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !this.contains(active)) {
      return false;
    }
    active.blur();
    return true;
  }

  /** Save the drafts into the item; fields/extra are committed in one place. */
  applyToItem(item: Zotero.Item): CreatorsExtWrite {
    const write = this.collectWrite();
    item.setCreators(write.creators);
    const extra = String(item.getField("extra") || "");
    item.setField(
      "extra",
      replaceExtraFieldBlock(extra, CREATORS_EXT_KEY, write.lines),
    );
    return write;
  }

  collectWrite(): CreatorsExtWrite {
    this.syncAllDraftsFromDOM();
    return buildCreatorsExtWrite(this._drafts);
  }

  private loadDrafts(item: Zotero.Item): void {
    const creators = item.getCreators();
    const loaded = loadCreatorsExt(
      String(item.getField("extra") || ""),
      this.creatorsToJSON(item),
    );
    for (const issue of loaded.issues) log.warn(issue);
    if (loaded.orphanLines.length) {
      log.warn(
        `${loaded.orphanLines.length} record(s) match no creator and will be dropped on save: ${loaded.orphanLines.join(" ")}`,
      );
    }
    this._drafts = creators.map((creator, index) => {
      const creatorType = Zotero.CreatorTypes.getName(creator.creatorTypeID);
      if (!this.isZoteroCreatorType(creatorType)) {
        log.warn(`Unknown creator type '${creatorType}' at row ${index + 1}`);
      }
      return {
        id: this._nextDraftID++,
        creatorType: this.isZoteroCreatorType(creatorType)
          ? creatorType
          : this.defaultCreatorType(item),
        fieldMode: creator.fieldMode,
        firstName: creator.firstName,
        lastName: creator.lastName,
        ...emptyCreatorExtensions(),
        ...loaded.bindings.get(index),
      };
    });
    this._dirty = false;
    // Match the item box: an editable item with no creators shows one empty
    // creator row instead of an empty placeholder.
    if (
      this._drafts.length === 0 &&
      this._editable &&
      item.isEditable() &&
      Zotero.CreatorTypes.itemTypeHasCreators(item.itemTypeID)
    ) {
      this._drafts.push(this.createBlankDraft(item));
    }
  }

  private creatorsToJSON(source: Zotero.Item): Creator[] {
    return source.getCreators().map((creator) => {
      const creatorTypeName = Zotero.CreatorTypes.getName(
        creator.creatorTypeID,
      );
      const creatorType = (
        this.isZoteroCreatorType(creatorTypeName)
          ? creatorTypeName
          : this.defaultCreatorType(source)
      ) as Creator["creatorType"];
      return creator.fieldMode === 1
        ? { creatorType, name: creator.lastName }
        : {
            creatorType,
            firstName: creator.firstName,
            lastName: creator.lastName,
          };
    });
  }

  private renderRows(focus?: FocusRequest): void {
    const rows = this._rows;
    if (!rows) return;
    rows.replaceChildren(
      ...this._drafts.map((draft, index) =>
        this.createCreatorRow(draft, index),
      ),
    );
    this.dispatchEvent(
      new CustomEvent("creator-layout-changed", { bubbles: true }),
    );
    this.scheduleLayout(this.nameInputs(rows));
    if (focus) {
      const row = rows.querySelector<HTMLElement>(
        `.creator-row[data-draft-id="${focus.draftID}"]`,
      );
      row?.querySelector<HTMLElement>(focus.selector)?.focus();
    }
  }

  private createCreatorRow(draft: CreatorDraft, index: number): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "creator-row";
    row.dataset.draftId = String(draft.id);

    const grippy = document.createXULElement("toolbarbutton");
    grippy.className = "zotero-clicky zotero-clicky-grippy creator-grippy";
    grippy.setAttribute("tabindex", "-1");
    grippy.setAttribute("tooltiptext", t("item-editor-drag-reorder"));
    grippy.setAttribute("aria-label", t("item-editor-drag-reorder"));
    grippy.addEventListener("mousedown", () => {
      if (this._item?.isEditable()) row.setAttribute("draggable", "true");
    });
    grippy.addEventListener("mouseup", () => {
      row.removeAttribute("draggable");
    });

    const labelCell = document.createElement("div");
    labelCell.className = "creator-label-cell";
    labelCell.append(grippy, this.createTypeLabel(draft));
    row.appendChild(labelCell);

    const dataCell = document.createElement("div");
    dataCell.className = "creator-data-cell";

    const nameCell = document.createElement("div");
    nameCell.className = "creator-name-box";
    const lastName = this.createNameInput(draft, index, "lastName");
    const firstName = this.createNameInput(draft, index, "firstName");
    firstName.hidden = draft.fieldMode === 1;
    nameCell.append(lastName, firstName);
    dataCell.appendChild(nameCell);
    const resizeNames = (): void => {
      this.scheduleLayout([lastName, firstName]);
    };
    lastName.addEventListener("input", resizeNames);
    firstName.addEventListener("input", resizeNames);

    for (const field of CREATOR_EXT_FIELDS) {
      const meta = EXTENSION_META[field];
      const input = this.createExtensionInput(
        field,
        draft[field],
        t(meta.placeholderKey),
      );
      input.addEventListener("input", () => {
        draft[field] = input.value;
        this._dirty = true;
        this.scheduleLayout([lastName, firstName]);
      });
      dataCell.appendChild(input);
    }

    const controls = document.createElement("div");
    controls.className = "creator-controls";
    controls.append(
      this.createModeButton(draft, lastName, firstName),
      this.createSwapButton(draft, lastName, firstName),
      this.createRowButton("minus", Zotero.getString("general.delete"), () =>
        this.removeCreator(draft.id),
      ),
      this.createRowButton("plus", Zotero.getString("general.create"), () =>
        this.addCreator(draft.id),
      ),
    );
    dataCell.appendChild(controls);
    row.appendChild(dataCell);
    this.bindDragHandlers(row);
    return row;
  }

  private onContextMenu = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    const input = textInputFromEvent(target);
    if (!input || !this.contains(input)) return;
    const row = input.closest(".creator-row") as HTMLElement | null;
    const draftID = row?.dataset.draftId ? Number(row.dataset.draftId) : null;
    if (!row || draftID === null || !Number.isFinite(draftID)) return;
    const menu = this._contextMenu;
    if (!menu) return;

    event.preventDefault();
    event.stopPropagation();
    this._contextDraftID = draftID;
    const draft = this._drafts.find((entry) => entry.id === draftID) ?? null;
    input.focus();
    this.buildContextMenu(menu, input, draft);

    const fallback = input.getBoundingClientRect();
    const screenX = event.screenX || window.screenX + fallback.left;
    const screenY = event.screenY || window.screenY + fallback.bottom;
    menu.openPopupAtScreen(screenX + 1, screenY + 1, true);
  };

  private buildContextMenu(
    menu: XULMenuPopupElement,
    input: HTMLInputElement | HTMLTextAreaElement,
    draft: CreatorDraft | null,
  ): void {
    // Name transforms only make sense on the last/first-name fields; extension
    // fields are normal text values and must not offer "swap names".
    const wrapper = input.closest("editable-text");
    const isNameInput =
      wrapper?.classList.contains("creator-last-name") ||
      wrapper?.classList.contains("creator-first-name") ||
      false;
    const creatorActions = isNameInput
      ? [
          {
            label: t("item-editor-swap-names"),
            disabled: !this._editable || !draft || draft.fieldMode === 1,
            command: () => this.swapNamesOfContextDraft(),
          },
          {
            label: t("item-editor-fix-case"),
            disabled:
              !this._editable || !draft || !this.canCapitalizeDraft(draft),
            command: () => this.capitalizeContextDraft(),
          },
        ]
      : [];
    populateEditContextMenu(menu, input, creatorActions);
  }

  private contextDraft(): CreatorDraft | null {
    if (this._contextDraftID === null) return null;
    return (
      this._drafts.find((draft) => draft.id === this._contextDraftID) ?? null
    );
  }

  private canCapitalizeDraft(draft: CreatorDraft): boolean {
    return (
      (!!draft.firstName &&
        Zotero.Utilities.capitalizeName(draft.firstName) !== draft.firstName) ||
      (!!draft.lastName &&
        Zotero.Utilities.capitalizeName(draft.lastName) !== draft.lastName)
    );
  }

  private swapNamesOfContextDraft(): void {
    const draft = this.contextDraft();
    if (!draft || draft.fieldMode === 1 || !this._editable) return;
    [draft.lastName, draft.firstName] = [draft.firstName, draft.lastName];
    this._dirty = true;
    this.renderRows();
  }

  private capitalizeContextDraft(): void {
    const draft = this.contextDraft();
    if (!draft || !this._editable) return;
    draft.lastName = Zotero.Utilities.capitalizeName(draft.lastName);
    draft.firstName = Zotero.Utilities.capitalizeName(draft.firstName);
    this._dirty = true;
    this.renderRows();
  }

  private fillCreatorTypeMenu(): void {
    const menu = this._typeMenu;
    const item = this._item;
    if (!menu || !item) return;
    menu.replaceChildren();
    for (const type of Zotero.CreatorTypes.getTypesForItemType(
      item.itemTypeID,
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

  private onTypeCommand(event: Event): void {
    const typeID = (event.target as XULMenuItemElement | null)?.getAttribute(
      "typeid",
    );
    if (!typeID || !this._typeMenuContext) return;
    const name = Zotero.CreatorTypes.getName(parseInt(typeID));
    if (!this.isZoteroCreatorType(name)) return;
    this._typeMenuContext.draft.creatorType = name;
    this._typeMenuContext.label.textContent =
      Zotero.CreatorTypes.getLocalizedString(name);
    this._dirty = true;
    this.applyColumnLayout();
  }

  private createTypeLabel(draft: CreatorDraft): HTMLDivElement {
    const wrapper = document.createElement("div");
    wrapper.className = "creator-type-label keyboard-clickable";
    wrapper.setAttribute("tabindex", "0");
    wrapper.setAttribute("role", "button");
    if (this._editable) {
      wrapper.classList.add("zotero-clicky");
      const dropmarker = document.createElement("span");
      dropmarker.className = "creator-type-dropmarker";
      wrapper.appendChild(dropmarker);
      const openMenu = (viaMouse: boolean): void => {
        const inner = wrapper.querySelector<HTMLLabelElement>(
          ".creator-type-label-inner",
        );
        if (!inner || !this._typeMenu) return;
        this._typeMenuContext = { draft, label: inner };
        this._typeMenu.openPopup(wrapper);
        if (viaMouse) this._typeMenu.setAttribute("blur-on-hidden", "true");
      };
      wrapper.addEventListener("click", (event: MouseEvent) => {
        openMenu(event.x !== 0 && event.y !== 0);
      });
      wrapper.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openMenu(false);
        }
      });
    }
    const label = document.createElement("label");
    label.className = "creator-type-label-inner";
    label.textContent = Zotero.CreatorTypes.getLocalizedString(
      draft.creatorType,
    );
    wrapper.appendChild(label);
    return wrapper;
  }

  private createNameInput(
    draft: CreatorDraft,
    index: number,
    namePart: "firstName" | "lastName",
  ): _ZoteroTypes.EditableText {
    const input = this.createTextField(
      `value ${namePart === "lastName" ? "creator-last-name" : "creator-first-name"}`,
      namePart === "lastName" ? draft.lastName : draft.firstName,
    );
    input.setAttribute("fieldname", `creator-${index}-${namePart}`);
    this.updateNameInputMode(input, namePart, draft.fieldMode);
    input.addEventListener("input", () => {
      if (namePart === "lastName") draft.lastName = input.value;
      else draft.firstName = input.value;
      this._dirty = true;
    });
    input.addEventListener("input", input.sizeToContent);
    input.addEventListener("blur", input.sizeToContent);
    return input;
  }

  private createExtensionInput(
    field: CreatorExtField,
    value: string,
    placeholder: string,
  ): _ZoteroTypes.EditableText {
    const input = this.createTextField(
      `value creator-extension-input creator-${field}-input`,
      value,
      placeholder,
    );
    input.setAttribute("aria-label", t(EXTENSION_META[field].labelKey));
    input.addEventListener("blur", () => this.applyColumnLayout());
    return input;
  }

  private createTextField(
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

  private createModeButton(
    draft: CreatorDraft,
    lastName: _ZoteroTypes.EditableText,
    firstName: _ZoteroTypes.EditableText,
  ): XULToolBarButtonElement {
    const button = document.createXULElement("toolbarbutton");
    button.className =
      "zotero-clicky zotero-clicky-switch-type creator-mode-button";
    button.setAttribute("tabindex", "0");
    this.updateModeButton(button, draft.fieldMode);
    button.addEventListener("command", () => {
      this.syncNameDraft(draft, lastName, firstName);
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
      this.updateNameInputMode(lastName, "lastName", next.fieldMode);
      this.updateNameInputMode(firstName, "firstName", next.fieldMode);
      firstName.hidden = next.fieldMode === 1;
      const swap = button.parentElement?.querySelector<HTMLButtonElement>(
        ".creator-swap-button",
      );
      if (swap) swap.disabled = next.fieldMode === 1;
      this.updateModeButton(button, next.fieldMode);
      this._dirty = true;
      this.scheduleLayout([lastName, firstName]);
      button.focus();
    });
    return button;
  }

  private createSwapButton(
    draft: CreatorDraft,
    lastName: _ZoteroTypes.EditableText,
    firstName: _ZoteroTypes.EditableText,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "creator-swap-button zotero-clicky";
    button.textContent = "⇄";
    button.setAttribute("aria-label", t("item-editor-swap-names"));
    button.title = t("item-editor-swap-names");
    button.disabled = draft.fieldMode === 1;
    button.addEventListener("click", () => {
      this.syncNameDraft(draft, lastName, firstName);
      [draft.lastName, draft.firstName] = [draft.firstName, draft.lastName];
      lastName.value = draft.lastName;
      firstName.value = draft.firstName;
      this._dirty = true;
      firstName.focus();
    });
    return button;
  }

  private createRowButton(
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

  private addDragListener(
    row: HTMLElement,
    type: "dragstart" | "dragover" | "drop" | "dragend",
    handler: (event: DragEvent) => void,
  ): void {
    row.addEventListener(type, (event) => handler(event as DragEvent));
  }

  private bindDragHandlers(row: HTMLDivElement): void {
    this.addDragListener(row, "dragstart", (event) => {
      if (row.getAttribute("draggable") !== "true" || !event.dataTransfer) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      this._dragDraftID = Number(row.dataset.draftId);
      event.dataTransfer.setData(DRAG_MIME, String(this._dragDraftID));
      event.dataTransfer.setData("text/plain", String(this._dragDraftID));
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setDragImage(row, 15, 15);
      setTimeout(() => row.classList.add("drag-hidden-creator"));
    });
    this.addDragListener(row, "dragover", (event) => {
      if (this._dragDraftID === null) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      const container = row.parentElement;
      const placeholder = container?.querySelector<HTMLElement>(
        ".creator-row.drag-hidden-creator",
      );
      if (!container || !placeholder || placeholder === row) return;
      const rect = row.getBoundingClientRect();
      const before = event.clientY < rect.top + rect.height / 2;
      container.insertBefore(placeholder, before ? row : row.nextSibling);
    });
    this.addDragListener(row, "drop", (event) => {
      if (this._dragDraftID === null) return;
      event.preventDefault();
      this.syncAllDraftsFromDOM();
      this.reorderDraftsFromDOM();
      this._dirty = true;
      const movedID = this._dragDraftID;
      this._dragDraftID = null;
      this.renderRows({ draftID: movedID, selector: ".creator-grippy" });
    });
    this.addDragListener(row, "dragend", () => {
      if (this._dragDraftID === null) return;
      this._dragDraftID = null;
      this.renderRows();
    });
  }

  private reorderDraftsFromDOM(): void {
    const rows = this.creatorRowElements();
    const byID = new Map(
      this._drafts.map((draft) => [String(draft.id), draft]),
    );
    const ordered: CreatorDraft[] = [];
    for (const row of rows) {
      const draft = row.dataset.draftId
        ? byID.get(row.dataset.draftId)
        : undefined;
      if (draft) ordered.push(draft);
    }
    if (ordered.length === this._drafts.length) this._drafts = ordered;
  }

  private createBlankDraft(item = this._item): CreatorDraft {
    return {
      id: this._nextDraftID++,
      creatorType: this.defaultCreatorType(item),
      fieldMode: Number(Zotero.Prefs.get("lastCreatorFieldMode")) === 1 ? 1 : 0,
      firstName: "",
      lastName: "",
      ...emptyCreatorExtensions(),
    };
  }

  private addCreator(afterID: number | null): void {
    if (!this._item?.isEditable() || !this._editable) return;
    this.syncAllDraftsFromDOM();
    const position =
      afterID === null
        ? this._drafts.length
        : this._drafts.findIndex((draft) => draft.id === afterID) + 1;
    const draft = this.createBlankDraft();
    if (position > 0) {
      draft.creatorType =
        this._drafts[position - 1]?.creatorType ?? draft.creatorType;
    }
    this._drafts.splice(position, 0, draft);
    this._dirty = true;
    this.renderRows({ draftID: draft.id, selector: ".creator-last-name" });
  }

  private removeCreator(id: number): void {
    if (!this._item?.isEditable() || !this._editable) return;
    this.syncAllDraftsFromDOM();
    const position = this._drafts.findIndex((draft) => draft.id === id);
    if (position < 0) return;
    this._drafts.splice(position, 1);
    this._dirty = true;
    if (
      this._drafts.length === 0 &&
      this._item?.isEditable() &&
      Zotero.CreatorTypes.itemTypeHasCreators(this._item.itemTypeID)
    ) {
      this._drafts.push(this.createBlankDraft());
    }
    const focusID =
      this._drafts[position]?.id ?? this._drafts[position - 1]?.id;
    this.renderRows(
      focusID === undefined
        ? undefined
        : { draftID: focusID, selector: ".zotero-clicky-minus" },
    );
  }

  private defaultCreatorType(item = this._item): ZoteroCreatorType {
    const first = item
      ? Zotero.CreatorTypes.getTypesForItemType(item.itemTypeID)[0]?.name
      : undefined;
    return this.isZoteroCreatorType(first) ? first : "author";
  }

  private syncNameDraft(
    draft: CreatorDraft,
    lastName: _ZoteroTypes.EditableText,
    firstName: _ZoteroTypes.EditableText,
  ): void {
    draft.lastName = lastName.value;
    draft.firstName = draft.fieldMode === 1 ? "" : firstName.value;
  }

  private updateNameInputMode(
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

  private updateModeButton(
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

  private isEditableText(
    element: unknown,
  ): element is _ZoteroTypes.EditableText {
    return (
      typeof element === "object" &&
      element !== null &&
      "sizeToContent" in element
    );
  }

  private scheduleLayout(inputs: readonly _ZoteroTypes.EditableText[]): void {
    setTimeout(() => {
      for (const input of inputs) input.sizeToContent();
      this.applyColumnLayout();
      this.dispatchEvent(
        new CustomEvent("creator-layout-changed", { bubbles: true }),
      );
    });
  }

  private nameInputs(container: Element): _ZoteroTypes.EditableText[] {
    return Array.from(
      container.querySelectorAll(".creator-last-name, .creator-first-name"),
    ).filter((element) => this.isEditableText(element));
  }

  private creatorRowElements(): HTMLElement[] {
    return Array.from(
      this.querySelectorAll<HTMLElement>(".creator-rows .creator-row"),
    );
  }

  private syncAllDraftsFromDOM(): void {
    const rows = this.creatorRowElements();
    const byID = new Map(
      this._drafts.map((draft) => [String(draft.id), draft]),
    );
    for (const row of rows) {
      const draft = row.dataset.draftId
        ? byID.get(row.dataset.draftId)
        : undefined;
      if (!draft) continue;
      const lastName =
        row.querySelector<_ZoteroTypes.EditableText>(".creator-last-name");
      const firstName = row.querySelector<_ZoteroTypes.EditableText>(
        ".creator-first-name",
      );
      if (lastName && firstName) this.syncNameDraft(draft, lastName, firstName);
      for (const field of CREATOR_EXT_FIELDS) {
        const input = row.querySelector<_ZoteroTypes.EditableText>(
          extensionInputSelector(field),
        );
        if (input) draft[field] = input.value;
      }
    }
  }

  private isZoteroCreatorType(value: unknown): value is ZoteroCreatorType {
    return (
      typeof value === "string" && Zotero.CreatorTypes.getID(value) !== false
    );
  }

  private applyColumnLayout(): void {
    const rows = this.creatorRowElements();
    if (!rows.length) {
      this.style.minWidth = "";
      return;
    }
    // Every creator part keeps its natural width. The window is widened to
    // fit them instead of squeezing names, extension fields or buttons.
    this.style.minWidth = "";
    this.applyNameWidths(rows);
    this.applyExtensionColumns(rows);
  }

  private applyNameWidths(rows: readonly HTMLElement[]): void {
    for (const row of rows) {
      const box = row.querySelector<HTMLElement>(".creator-name-box");
      if (!box) continue;
      box.style.flex = "0 0 auto";
      box.style.minWidth = "0";
      box.style.maxWidth = "none";
      for (const input of box.querySelectorAll("editable-text")) {
        if ((input as HTMLElement).hidden) continue;
        const element = input as _ZoteroTypes.EditableText;
        const width = Math.ceil(
          this.contentWidth(element, element.value || element.placeholder),
        );
        element.style.flex = "0 0 auto";
        element.style.width = `${Math.max(width, 18)}px`;
        element.style.minWidth = "0";
        element.style.maxWidth = "none";
      }
    }
  }

  private applyExtensionColumns(rows: readonly HTMLElement[]): void {
    for (const field of CREATOR_EXT_FIELDS) {
      const inputs = rows
        .map((row) =>
          row.querySelector<_ZoteroTypes.EditableText>(
            extensionInputSelector(field),
          ),
        )
        .filter((input): input is _ZoteroTypes.EditableText =>
          this.isEditableText(input),
        );
      if (!inputs.length) continue;
      const width = Math.max(
        this.contentWidth(inputs[0], inputs[0].placeholder),
        ...inputs.map((input) => this.contentWidth(input, input.value)),
      );
      const fitted = Math.min(160, Math.max(36, Math.ceil(width)));
      for (const input of inputs) {
        input.style.flex = "0 0 auto";
        input.style.width = `${fitted}px`;
        input.style.minWidth = "0";
        input.style.maxWidth = "none";
      }
    }
  }

  private contentWidth(input: _ZoteroTypes.EditableText, text: string): number {
    const probe = this.createTextField(input.className, text, text);
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.minWidth = "0";
    const host =
      input.parentElement ?? (document.body as HTMLElement | null) ?? null;
    if (!host) return 0;
    host.appendChild(probe);
    probe.sizeToContent();
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return width;
  }
}

customElements.define("creator-editor", CreatorEditor);
