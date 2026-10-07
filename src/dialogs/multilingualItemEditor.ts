import { switchCreatorNameMode } from "../utils/multilingualDraft";

/**
 * Own element instead of the item pane's `<info-box>`, whose affordances (item
 * type menu, creator retype) must stay out; edits are in-memory until Save. */

/** Fields the item pane hides; copies do not carry them either. */
const IGNORED_FIELDS = new Set(["abstractNote"]);
/** Stored as primary columns; shown read-only, as in the item pane. */
const READ_ONLY_FIELDS = new Set(["dateAdded", "dateModified"]);
/** Lines a multiline field opens with, mirroring `itemBox.showEditor()`. */
const MULTILINE_OPENING_LINES = 6;

export class MultilingualItemEditor extends XULElement {
  private _item: Zotero.Item | null = null;
  private _editable = true;
  private _table: HTMLDivElement | null = null;
  /** Set on focus so `blurOpenField()` needs no DOM walk from the input. */
  private _focusedField: _ZoteroTypes.EditableText | null = null;
  /** Name fields awaiting `sizeToContent()`, which needs them in the DOM. */
  private _pendingSizing: _ZoteroTypes.EditableText[] = [];

  get item(): Zotero.Item | null {
    return this._item;
  }

  set item(item: Zotero.Item | null) {
    if (this._item === item) {
      return;
    }
    this._item = item;
    this.render();
  }

  get editable(): boolean {
    return this._editable;
  }

  set editable(editable: boolean) {
    if (this._editable === editable) {
      return;
    }
    this._editable = editable;
    // Re-render only on change: a rebuild around every save drops focus/scroll.
    this.render();
  }

  /**
   * Point the editor at `item` in `editable` state with a single rebuild; the
   * two setters would render the table once per property and drop the first
   * tree, which is what the save-failure path did.
   */
  configure(item: Zotero.Item | null, editable: boolean): void {
    if (this._item === item && this._editable === editable) {
      return;
    }
    this._item = item;
    this._editable = editable;
    this.render();
  }

  connectedCallback(): void {
    const table = document.createElement("div");
    table.id = "info-table";
    this._table = table;
    this.replaceChildren(table);
    this.render();
  }

  /** Rebuild every row: fields in schema order, creator rows after title. */
  render(): void {
    const table = this._table;
    if (!table) {
      return;
    }
    table.replaceChildren();
    this._focusedField = null;
    this._pendingSizing = [];
    const item = this._item;
    if (!item?.isRegularItem()) {
      return;
    }

    const fragment = document.createDocumentFragment();
    const fieldNames = getFieldNames(item);
    const titleName = getTitleFieldName(item);
    const creatorsAfter = titleName ? fieldNames.indexOf(titleName) : -1;
    if (creatorsAfter === -1) {
      this.appendCreatorRows(fragment, item);
    }
    for (let index = 0; index < fieldNames.length; index++) {
      this.appendFieldRow(fragment, item, fieldNames[index]);
      if (index === creatorsAfter) {
        this.appendCreatorRows(fragment, item);
      }
    }
    // As `itemBox.render()`: rows measured mid-add overlap in Gecko's grid.
    table.style.display = "block";
    try {
      table.appendChild(fragment);
      for (const field of this._pendingSizing) {
        field.sizeToContent();
      }
    } finally {
      table.style.display = "";
      this._pendingSizing = [];
    }
  }

  focusField(fieldName: string): void {
    this.querySelector<HTMLElement & { focus(): void }>(
      `editable-text[fieldname="${fieldName}"]`,
    )?.focus();
  }

  blurOpenField(): boolean {
    const field = this._focusedField;
    if (!field) {
      return false;
    }
    field.blur();
    return true;
  }

  /**
   * Whether the focused field holds text that was never committed. A field
   * stays focused while the window is inactive (Zotero's `editable-text`
   * ignores that blur), so the draft alone cannot tell whether the user typed
   * something; the retarget path uses this to keep that input.
   */
  hasPendingEdit(): boolean {
    const field = this._focusedField;
    return !!field && field.value.trim() !== field.initialValue.trim();
  }

  private isEditableField(fieldName: string): boolean {
    return this._editable && !READ_ONLY_FIELDS.has(fieldName);
  }

  private appendFieldRow(
    fragment: DocumentFragment,
    item: Zotero.Item,
    fieldName: string,
  ): void {
    // Primary columns are not item fields; `ItemFields` queries throw on them.
    const isPrimary = Zotero.Items.isPrimaryField(fieldName);
    const isDate = !isPrimary && isDateField(fieldName);
    let value: string;
    if (isPrimary) {
      // Stored as a UTC SQL timestamp; shown in local time.
      value = dateTimeFromUTC(item.getField(fieldName));
    } else if (isDate) {
      // Date fields store a multipart string; show its user part.
      value = getDateDisplayValue(item, fieldName);
    } else {
      value = item.getField(fieldName);
    }
    const field = this.createFieldElement(fieldName, value);

    const data = document.createElement("div");
    data.className = "meta-data";
    if (isDate) {
      data.classList.add("date-box");
      data.appendChild(field);
      const status = document.createElement("span");
      status.className = "date-status show-on-hover";
      status.textContent = getDateOrderHint(item, fieldName);
      data.appendChild(status);
      setDateTooltip(field, item, fieldName);
    } else {
      data.appendChild(field);
    }
    fragment.appendChild(
      this.createRow(
        fieldName,
        Zotero.ItemFields.getLocalizedString(fieldName),
        data,
        field,
      ),
    );
  }

  /**
   * Creator rows keep only the item pane's name editing: names stay editable
   * and toggle field modes; creators cannot be added, removed, or retyped. */
  private appendCreatorRows(
    fragment: DocumentFragment,
    item: Zotero.Item,
  ): void {
    for (let index = 0; index < item.numCreators(); index++) {
      const creator = item.getCreator(index);
      if (!creator) {
        continue;
      }
      const singleField = creator.fieldMode === 1;
      const data = document.createElement("div");
      data.className = "meta-data creator-type-value";
      const nameBox = document.createElement("span");
      nameBox.className = "creator-name-box";

      // The stylesheet keys the comma off `fieldMode`, as in the item pane.
      const lastNameField = this.createFieldElement(
        `creator-${index}-lastName`,
        creator.lastName,
        { fieldMode: String(creator.fieldMode) },
      );
      lastNameField.classList.add("creator-last-name");
      lastNameField.placeholder = singleField
        ? `(${Zotero.getString("pane.item.defaultFullName")})`
        : `(${Zotero.getString("pane.item.defaultLastName")})`;
      const firstNameField = this.createFieldElement(
        `creator-${index}-firstName`,
        creator.firstName,
      );
      firstNameField.classList.add("creator-first-name");
      firstNameField.placeholder = `(${Zotero.getString("pane.item.defaultFirstName")})`;
      firstNameField.hidden = singleField;
      nameBox.append(lastNameField, firstNameField);
      data.appendChild(nameBox);
      if (this._editable) {
        data.appendChild(this.createNameModeButton(index, creator.fieldMode));
      }
      // Only two-field names are sized; a single full-name field fills the row.
      if (!singleField) {
        this._pendingSizing.push(lastNameField, firstNameField);
        if (this._editable) {
          for (const field of [lastNameField, firstNameField]) {
            field.addEventListener("input", field.sizeToContent);
            field.addEventListener("blur", field.sizeToContent);
          }
        }
      }

      fragment.appendChild(
        this.createRow(
          `creator-${index}-typeID`,
          Zotero.CreatorTypes.getLocalizedString(creator.creatorTypeID),
          data,
          lastNameField,
        ),
      );
    }
  }

  /** The item pane's toggle; its classes give the stock styling. */
  private createNameModeButton(
    index: number,
    fieldMode: 0 | 1,
  ): XULToolBarButtonElement {
    const button = document.createXULElement("toolbarbutton");
    button.setAttribute(
      "class",
      "zotero-clicky zotero-clicky-switch-type show-on-hover no-display",
    );
    button.setAttribute("type", fieldMode === 1 ? "single" : "dual");
    button.setAttribute(
      "tooltiptext",
      Zotero.getString(
        fieldMode === 1
          ? "pane.item.switchFieldMode.two"
          : "pane.item.switchFieldMode.one",
      ),
    );
    button.dataset.creatorIndex = String(index);
    button.addEventListener("command", () => this.switchNameMode(index));
    return button;
  }

  private switchNameMode(index: number): void {
    const item = this._item;
    const existing = item?.getCreator(index);
    if (!item || !existing) {
      return;
    }
    // A name typed in the row has not blurred into the draft yet; commit first.
    this.blurOpenField();
    const current = item.getCreator(index);
    if (!current) {
      return;
    }
    const converted = switchCreatorNameMode(
      {
        fieldMode: current.fieldMode,
        firstName: current.firstName,
        lastName: current.lastName,
      },
      current.fieldMode === 1 ? 0 : 1,
    );
    // No `lastCreatorFieldMode`: it only defaults new rows in the main window.
    item.setCreator(index, { ...current, ...converted });
    this.render();
    // The redraw replaced the button; keep keyboard focus on the row.
    this.querySelector<HTMLElement>(
      `.zotero-clicky-switch-type[data-creator-index="${index}"]`,
    )?.focus();
  }

  private createRow(
    fieldName: string,
    labelText: string,
    data: HTMLDivElement,
    focusTarget: _ZoteroTypes.EditableText | null,
  ): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "meta-row";

    const cell = document.createElement("div");
    cell.className = "meta-label";
    cell.setAttribute("fieldname", fieldName);
    const label = document.createElement("label");
    label.className = "key";
    label.textContent = labelText;
    cell.appendChild(label);
    if (this._editable && focusTarget) {
      label.addEventListener("mousedown", (event) => event.preventDefault());
      label.addEventListener("click", (event) => {
        event.preventDefault();
        focusTarget.focus();
      });
    }

    row.appendChild(cell);
    row.appendChild(data);
    return row;
  }

  private createFieldElement(
    fieldName: string,
    value: string,
    attributes: Record<string, string> = {},
  ): _ZoteroTypes.EditableText {
    const element = document.createXULElement("editable-text");
    element.classList.add("value");
    element.setAttribute("tight", "true");
    element.setAttribute("fieldname", fieldName);
    // As `createFieldValueElement()`: multiline auto-sizes, creators one line.
    if (Zotero.ItemFields.isMultiline(fieldName)) {
      element.setAttribute("multiline", "true");
    } else if (fieldName.startsWith("creator-")) {
      element.setAttribute("nowrap", "true");
    }
    for (const [key, attributeValue] of Object.entries(attributes)) {
      element.setAttribute(key, attributeValue);
    }
    if (this.isEditableField(fieldName)) {
      element.addEventListener("focus", () => this.onFieldFocus(element));
      element.addEventListener("blur", () => this.onFieldBlur(element));
    } else {
      element.setAttribute("readonly", "true");
    }
    element.setAttribute("dir", "auto");
    element.value = value;
    return element;
  }

  private onFieldFocus(element: _ZoteroTypes.EditableText): void {
    this._focusedField = element;
    const fieldName = element.getAttribute("fieldname");
    if (!fieldName) {
      return;
    }
    if (Zotero.ItemFields.isMultiline(fieldName)) {
      element.setAttribute("min-lines", String(MULTILINE_OPENING_LINES));
    }
    if (STORED_AS_UTC.has(fieldName)) {
      // Edit in local time, as `itemBox.showEditor()` does: the displayed value
      // is a localized date, which parsing back could only do lossily.
      const item = this._item;
      element.value = item ? getDateEditValue(item, fieldName) : "";
    }
  }

  private onFieldBlur(element: _ZoteroTypes.EditableText): void {
    if (this._focusedField === element) {
      this._focusedField = null;
    }
    const item = this._item;
    if (!item || element.cancelled) {
      return;
    }
    const fieldName = element.getAttribute("fieldname");
    if (!fieldName) {
      return;
    }
    if (Zotero.ItemFields.isMultiline(fieldName)) {
      element.setAttribute("min-lines", "1");
    }
    const value = element.value.trim();
    if (value === element.initialValue.trim()) {
      // Nothing was typed: writing back would rewrite the field from a
      // displayed value, and Escape restores the initial value before blurring.
      if (STORED_AS_UTC.has(fieldName)) {
        element.value = getDateDisplayValue(item, fieldName);
      }
      return;
    }
    element.value = value;
    if (fieldName.startsWith("creator-")) {
      commitCreatorField(item, fieldName, value);
      return;
    }
    if (isDateField(fieldName)) {
      commitDateField(item, element, fieldName);
      return;
    }
    item.setField(fieldName, value);
  }
}

/**
 * UTC SQL date fields shown via `dateTimeFromUTC()`; others are multipart text.
 */
const STORED_AS_UTC = new Set([
  "dateAdded",
  "dateModified",
  "accessDate",
  "dateSent",
  "dateDue",
  "accepted",
]);

function isDateField(fieldName: string): boolean {
  return STORED_AS_UTC.has(fieldName) || Zotero.ItemFields.isDate(fieldName);
}

/**
 * Write a date field as the item pane does: parse descriptive strings, convert
 * local input to UTC for UTC-stored fields, and clear unparsable input. */
function commitDateField(
  item: Zotero.Item,
  element: _ZoteroTypes.EditableText,
  fieldName: string,
): void {
  item.setField(fieldName, parseDateInput(fieldName, element.value));
  if (STORED_AS_UTC.has(fieldName)) {
    // Only these are re-displayed from the stored value, as in the item pane.
    element.value = getDateDisplayValue(item, fieldName);
  }
  refreshDateRow(element, item, fieldName);
}

function refreshDateRow(
  element: _ZoteroTypes.EditableText,
  item: Zotero.Item,
  fieldName: string,
): void {
  const status = element.parentElement?.querySelector(".date-status");
  if (status) {
    status.textContent = getDateOrderHint(item, fieldName);
  }
  setDateTooltip(element, item, fieldName);
}

function setDateTooltip(
  element: _ZoteroTypes.EditableText,
  item: Zotero.Item,
  fieldName: string,
): void {
  element.tooltipText = Zotero.Date.multipartToSQL(
    item.getField(fieldName, true),
  );
}

function getDateDisplayValue(item: Zotero.Item, fieldName: string): string {
  const stored = Zotero.Date.multipartToStr(item.getField(fieldName, true));
  return STORED_AS_UTC.has(fieldName) ? dateTimeFromUTC(stored) : stored;
}

/** Mirror of `itemBox.showEditor()`'s date branch: the local SQL form to edit. */
function getDateEditValue(item: Zotero.Item, fieldName: string): string {
  const stored = item.getField(fieldName);
  if (!stored) {
    return "";
  }
  // A date without a time is local already; a datetime is stored as UTC.
  const localDate = Zotero.Date.isSQLDate(stored)
    ? Zotero.Date.sqlToDate(stored)
    : Zotero.Date.sqlToDate(stored, true);
  if (!localDate) {
    return "";
  }
  // Editing never shows a time, as in the item pane.
  return Zotero.Date.dateToSQL(localDate).replace(" 00:00:00", "");
}

/** Mirror of `itemBox.dateTimeFromUTC()`: a UTC SQL value in local time. */
function dateTimeFromUTC(value: string): string {
  if (!value) {
    return "";
  }
  const date = Zotero.Date.sqlToDate(value, true);
  if (!date) {
    return "";
  }
  // UTC-midnight dates can land on the previous day locally; read at noon.
  if (Zotero.Date.isSQLDate(value)) {
    const localDate = Zotero.Date.sqlToDate(`${value} 12:00:00`);
    return localDate ? localDate.toLocaleDateString() : "";
  }
  return date.toLocaleString();
}

function getDateOrderHint(item: Zotero.Item, fieldName: string): string {
  const multipart = Zotero.Date.multipartToStr(item.getField(fieldName, true));
  if (!multipart) {
    return "";
  }
  const { order } = Zotero.Date.strToDate(multipart);
  return order ? order.split("").join(" ") : "";
}

/**
 * The stored value for a typed date, mirroring `itemBox.showEditor()`: UTC
 * fields convert local times, others only parse descriptive strings. */
function parseDateInput(fieldName: string, raw: string): string {
  if (raw === "") {
    return "";
  }
  switch (fieldName) {
    case "accessDate": {
      const value = Zotero.Date.parseDescriptiveString(raw);
      if (value === "now") {
        return Zotero.Date.dateToSQL(new Date(), true);
      }
      if (Zotero.Date.isSQLDate(value)) {
        return toLocalDateOnly(value);
      }
      if (Zotero.Date.isSQLDateTime(value)) {
        // A typed datetime is local time; parse it non-UTC and store as UTC.
        const localDate = Zotero.Date.sqlToDate(value);
        return localDate ? Zotero.Date.dateToSQL(localDate, true) : "";
      }
      return toDateOnlyFromText(value);
    }
    case "dateSent":
    case "dateDue":
    case "accepted":
      return Zotero.Date.isSQLDate(raw)
        ? toLocalDateOnly(raw)
        : toDateOnlyFromText(raw);
  }
  if (Zotero.ItemFields.isFieldOfBase(fieldName, "originalDate")) {
    // Original Date is stored verbatim, as in the item pane.
    return raw;
  }
  return Zotero.Date.parseDescriptiveString(raw);
}

/** A typed date read locally, written as a SQL date without a time. */
function toDateOnlyFromText(value: string): string {
  const date = Zotero.Date.strToDate(value);
  const year = Number(date.year);
  if (!year || date.month === undefined || !date.day) {
    return "";
  }
  return toLocalDateOnly(
    Zotero.Date.dateToSQL(new Date(year, date.month, date.day)),
  );
}

function toLocalDateOnly(value: string): string {
  const localDate = Zotero.Date.sqlToDate(value);
  return localDate
    ? Zotero.Date.dateToSQL(localDate).replace(" 00:00:00", "")
    : "";
}

function getFieldNames(item: Zotero.Item): string[] {
  const names: string[] = [];
  for (const fieldID of Zotero.ItemFields.getItemTypeFields(item.itemTypeID)) {
    const name = Zotero.ItemFields.getName(fieldID);
    if (name && !IGNORED_FIELDS.has(name)) {
      names.push(name);
    }
  }
  // Primary columns are not in a type's field list; add them explicitly.
  names.push("dateAdded", "dateModified");
  return names;
}

/**
 * The field holding this type's title: `bookSection` maps `bookTitle` onto base
 * `title`, so the type-specific field must be found. */
function getTitleFieldName(item: Zotero.Item): string | null {
  const titleFieldID = Zotero.ItemFields.getFieldIDFromTypeAndBase(
    item.itemTypeID,
    "title",
  );
  return titleFieldID ? Zotero.ItemFields.getName(titleFieldID) || null : null;
}

function commitCreatorField(
  item: Zotero.Item,
  fieldName: string,
  value: string,
): void {
  const [, indexPart, namePart] = fieldName.split("-");
  const index = Number(indexPart);
  const existing = item.getCreator(index);
  if (!existing) {
    return;
  }
  const creator: _ZoteroTypes.Item.Creator = {
    creatorTypeID: existing.creatorTypeID,
    fieldMode: existing.fieldMode,
    firstName: existing.firstName,
    lastName: existing.lastName,
  };
  if (namePart === "lastName") {
    creator.lastName = value;
  } else {
    creator.firstName = value;
  }
  item.setCreator(index, creator);
}

customElements.define("multilingual-item-editor", MultilingualItemEditor);
