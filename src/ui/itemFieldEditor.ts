import { switchCreatorNameMode } from "../utils/creatorName";
import { isRichTextField } from "../utils/richTextFieldScope";
import {
  getExtraKeySuggestions,
  isManagedExtraKey,
  isMarkableExtraKey,
  parseExtraEditorDocument,
  serializeExtraEditorDocument,
  type ExtraDocumentRow,
  type ExtraEditorDocument,
} from "../utils/extraFieldLines";
import { extractFieldCheckTargets } from "../utils/fieldCheckTargets";
import { isValidExtraKey, normalizeExtraKey } from "@banyan/core/items/extra";
import { FieldMarkupToolbar } from "./fieldMarkupToolbar";
import {
  populateEditContextMenu,
  textInputFromEvent,
  type EditMenuExtraItem,
} from "../utils/editContextMenu";
import { useL10n } from "../utils/locale";
import { createLogger } from "../utils/logger";
import type { FieldValidationIssue } from "../utils/itemFieldCheckText";

export type { FieldValidationIssue } from "../utils/itemFieldCheckText";

const t = useL10n(["itemEditor.ftl"]);
const log = createLogger("item-field-editor");

/**
 * Shared item field editor. The multilingual dialog and the full item editor
 * both render this element; the markup toolbar is composed in, not baked into
 * the row code.
 */

/** Fields the item pane hides; copies do not carry them either. */
const IGNORED_FIELDS = new Set(["abstractNote", "extra"]);
/** Stored as primary columns; shown read-only, as in the item pane. */
const READ_ONLY_FIELDS = new Set(["dateAdded", "dateModified"]);
/** Lines a multiline field opens with, mirroring `itemBox.showEditor()`. */
const MULTILINE_OPENING_LINES = 6;

type EditableExtraRow = ExtraDocumentRow & { id: number };
type EditableExtraDocument = Omit<ExtraEditorDocument, "rows"> & {
  rows: EditableExtraRow[];
};

type FieldTarget = {
  row: HTMLElement;
  input: _ZoteroTypes.EditableText;
  label: string;
};

/**
 * The check message is usually self-contained, so a failing field's tooltip
 * shows only that message. For a checker error the description still identifies
 * which check failed, because the error text may otherwise have no context.
 */
function fieldIssueText(issue: FieldValidationIssue): string {
  const description = issue.description.trim();
  const detail = issue.detail.trim();
  if (issue.status === "error" && description) {
    return detail ? `${description}\n${detail}` : description;
  }
  return detail || description;
}

/** Resolve a check's prose candidate to a visible field row. */
function resolveFieldTarget(
  targets: Map<string, FieldTarget>,
  candidate: string,
): FieldTarget | null {
  const text = candidate.trim();
  if (!text) return null;
  return (
    targets.get(text.toLowerCase()) ??
    targets.get(normalizeExtraKey(text)) ??
    null
  );
}

/** Fields whose field menu offers title/sentence casing, as in the item pane. */
function isTransformableTitleField(fieldName: string): boolean {
  const fieldID = Zotero.ItemFields.getID(fieldName);
  if (!fieldID) return false;
  return (
    fieldName === "seriesTitle" ||
    fieldName === "shortTitle" ||
    Zotero.ItemFields.isFieldOfBase(fieldID, "title") ||
    Zotero.ItemFields.isFieldOfBase(fieldID, "publicationTitle")
  );
}

/** The external URL the item pane's open-link button would use, if any. */
function fieldExternalLink(fieldName: string, value: string): string | null {
  if (fieldName === "url" || fieldName === "homepage") {
    return Zotero.Utilities.isHTTPURL(value, true) ? value : null;
  }
  if (fieldName === "DOI" && value) {
    const doi = Zotero.Utilities.cleanDOI(value);
    if (!doi) return null;
    return (
      "https://doi.org/" +
      doi
        .replace(/#/g, "%23")
        .replace(/\?/g, "%3f")
        .replace(/%/g, "%25")
        .replace(/"/g, "%22")
    );
  }
  if (fieldName === "PMID" && value) {
    const pmid = value.trim();
    return /^\d+$/.test(pmid)
      ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
      : null;
  }
  if (fieldName === "PMCID" && value) {
    let pmcid = value.trim().toUpperCase();
    if (/^\d+$/.test(pmcid)) {
      pmcid = `PMC${pmcid}`;
    }
    return /^PMC\d+$/.test(pmcid)
      ? `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`
      : null;
  }
  return null;
}

/** As `itemBox.createOpenLinkIcon()`, with the item pane's hover behavior. */
function createOpenLinkButton(link: string): XULToolBarButtonElement {
  const button = document.createXULElement("toolbarbutton");
  button.className = "zotero-clicky zotero-clicky-open-link show-on-hover";
  button.setAttribute("tabindex", "0");
  const label = t("item-editor-view-online");
  button.setAttribute("tooltiptext", label);
  button.setAttribute("aria-label", label);
  button.addEventListener("click", (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      Zotero.launchURL(link);
    } catch (error) {
      log.error("Failed to open the field link", error);
    }
  });
  return button;
}

export class ItemFieldEditor extends XULElement {
  private _item: Zotero.Item | null = null;
  private _editable = true;
  private _dirty = false;
  private _creatorsVisible = true;
  private _creatorsHost: Element | null = null;
  private _table: HTMLDivElement | null = null;
  private _summary: HTMLDivElement | null = null;
  private _summaryText: HTMLSpanElement | null = null;
  private _summaryItems: HTMLSpanElement | null = null;
  private _summaryNotices: HTMLSpanElement | null = null;
  /** Rows currently showing an inline error, for rebuilding the summary. */
  private _validationTargets = new Map<
    HTMLElement,
    { target: FieldTarget; count: number }
  >();
  private _validationIssueCount = 0;
  private _validationUnmatched = 0;
  private _validationErrors = 0;
  private _validationSeq = 0;
  private _toolbar: FieldMarkupToolbar | null = null;
  private _contextMenu: XULMenuPopupElement | null = null;
  /** Set on focus so `blurOpenField()` needs no DOM walk from the input. */
  private _focusedField: _ZoteroTypes.EditableText | null = null;
  /** Key inputs are outside the item-field commit path; track separately. */
  private _focusedExtraKey: _ZoteroTypes.EditableText | null = null;
  /** Name fields awaiting `sizeToContent()`, which needs them in the DOM. */
  private _pendingSizing: _ZoteroTypes.EditableText[] = [];
  private _extra: EditableExtraDocument | null = null;
  private _extraRowElements: HTMLElement[] = [];
  private _nextExtraRowID = 1;

  get item(): Zotero.Item | null {
    return this._item;
  }

  set item(item: Zotero.Item | null) {
    if (this._item === item) {
      return;
    }
    this._item = item;
    this._dirty = false;
    this.render();
  }

  get editable(): boolean {
    return this._editable;
  }

  get dirty(): boolean {
    return this._dirty;
  }

  /** ItemEditor composes its own full creator editor and hides this simple one. */
  get creatorsVisible(): boolean {
    return this._creatorsVisible;
  }

  set creatorsVisible(value: boolean) {
    if (this._creatorsVisible === value) return;
    this._creatorsVisible = value;
    this.render();
  }

  /** An external creator editor to place where the item pane puts creators. */
  get creatorsHost(): Element | null {
    return this._creatorsHost;
  }

  set creatorsHost(host: Element | null) {
    if (this._creatorsHost === host) return;
    this._creatorsHost = host;
    this.render();
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
    this._dirty = false;
    this.render();
  }

  connectedCallback(): void {
    const table = document.createElement("div");
    table.id = "info-table";
    this._table = table;
    // The editor window is a flex column and the table is not height-constrained;
    // keep grid rows at content height instead of stretching the first row.
    table.style.alignContent = "start";
    table.style.gridAutoRows = "max-content";
    table.style.alignItems = "start";
    this._toolbar = new FieldMarkupToolbar();
    const contextMenu = document.createXULElement("menupopup");
    contextMenu.className = "item-field-context-menu";
    this._contextMenu = contextMenu as unknown as XULMenuPopupElement;
    // The summary belongs to the scrolling field area, above the title row.
    const summary = document.createElement("div");
    summary.className = "field-validation-summary";
    summary.hidden = true;
    const summaryText = document.createElement("span");
    summaryText.className = "field-validation-summary-text";
    const summaryItems = document.createElement("span");
    summaryItems.className = "field-validation-summary-items";
    const summaryNotices = document.createElement("span");
    summaryNotices.className = "field-validation-summary-notices";
    summary.append(summaryText, summaryItems, summaryNotices);
    this._summary = summary;
    this._summaryText = summaryText;
    this._summaryItems = summaryItems;
    this._summaryNotices = summaryNotices;
    // The toolbar stays fixed; only the item information below it scrolls.
    const viewport = document.createElement("div");
    viewport.className = "field-editor-scroll";
    viewport.appendChild(table);
    this.replaceChildren(this._toolbar.element, viewport, contextMenu);
    document.addEventListener("contextmenu", this.onContextMenu, true);
    window.addEventListener("resize", this.onWindowResize);
    this.addEventListener("creator-layout-changed", this.onCreatorRendered);
    this.addEventListener("input", this.onValidationInput);
    this.render();
  }

  disconnectedCallback(): void {
    window.removeEventListener("resize", this.onWindowResize);
    this.removeEventListener("creator-layout-changed", this.onCreatorRendered);
    this.removeEventListener("input", this.onValidationInput);
    document.removeEventListener("contextmenu", this.onContextMenu, true);
  }

  private readonly onContextMenu = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    const input = textInputFromEvent(target);
    if (!input || !this._table?.contains(input)) return;
    const menu = this._contextMenu;
    if (!menu) return;

    event.preventDefault();
    event.stopPropagation();
    input.focus();
    populateEditContextMenu(menu, input, this.fieldTransformExtras(input));
    const rect = input.getBoundingClientRect();
    const screenX = event.screenX || window.screenX + rect.left;
    const screenY = event.screenY || window.screenY + rect.bottom;
    menu.openPopupAtScreen(screenX + 1, screenY + 1, true);
  };

  /**
   * Native `buildFieldTransformMenu` adds title/sentence casing only for the
   * fields the item pane offers it on, and disables an action that would not
   * change the value.
   */
  private fieldTransformExtras(
    input: HTMLInputElement | HTMLTextAreaElement,
  ): EditMenuExtraItem[] {
    if (!this._editable) return [];
    const element = input.closest(
      "editable-text",
    ) as _ZoteroTypes.EditableText | null;
    const fieldName = element?.getAttribute("fieldname");
    if (!element || !fieldName || !isTransformableTitleField(fieldName)) {
      return [];
    }
    const value = input.value;
    const titleCased = Zotero.Utilities.capitalizeTitle(value, true);
    const sentenceCased = Zotero.Utilities.sentenceCase(value);
    return [
      {
        label: Zotero.getString("zotero.item.textTransform.titlecase"),
        disabled: titleCased === value,
        command: () => this.applyFieldTransform(element, titleCased),
      },
      {
        label: Zotero.getString("zotero.item.textTransform.sentencecase"),
        disabled: sentenceCased === value,
        command: () => this.applyFieldTransform(element, sentenceCased),
      },
    ];
  }

  /** As `itemBox._setFieldTransformedValue()`, including the shortTitle sync. */
  private applyFieldTransform(
    element: _ZoteroTypes.EditableText,
    newValue: string,
  ): void {
    const fieldName = element.getAttribute("fieldname");
    const item = this._item;
    if (!fieldName || !item || newValue === element.value) return;
    element.value = newValue;
    this._dirty = true;
    item.setField(fieldName, newValue);
    if (!Zotero.ItemFields.isFieldOfBase(fieldName, "title")) return;
    const shortTitle = item.getField("shortTitle");
    if (
      !shortTitle ||
      !newValue.toLowerCase().startsWith(shortTitle.toLowerCase())
    ) {
      return;
    }
    const shortValue = newValue.slice(0, shortTitle.length);
    item.setField("shortTitle", shortValue);
    const shortElement = this.querySelector<_ZoteroTypes.EditableText>(
      'editable-text[fieldname="shortTitle"]',
    );
    if (shortElement) {
      shortElement.value = shortValue;
    }
  }

  private readonly onValidationInput = (event: Event): void => {
    const target = event.target as Element | null;
    const row = target?.closest(".meta-row.has-field-error") as
      HTMLElement | null | undefined;
    if (row) this.clearRowValidation(row);
  };

  private readonly onWindowResize = (): void => {
    this.syncLabelWidth();
  };

  private readonly onCreatorRendered = (): void => {
    this.syncLabelWidth();
  };

  private syncLabelWidth(): void {
    const table = this._table;
    if (!table) return;
    let width = 0;
    // Measure the text, not the grid cell: the cell already fills the current
    // column, which would make the width ratchet up with long extra keys.
    for (const label of table.querySelectorAll<HTMLElement>(
      ".meta-row:not(.creator-section-row):not(.extra-row):not(.extra-other-row) .meta-label > label",
    )) {
      width = Math.max(width, measureTextWidth(label));
    }
    // A creator type can be longer than the longest field label; widen the
    // shared label column so the type and its dropmarker stay complete.
    for (const typeLabel of table.querySelectorAll<HTMLElement>(
      ".creator-type-label-inner",
    )) {
      width = Math.max(width, measureTextWidth(typeLabel) + 22);
    }
    if (width > 0) {
      // Let the creator rows and extra keys share the field label column.
      this.style.setProperty(
        "--item-editor-label-width",
        `${Math.ceil(width) + 2}px`,
      );
    }
  }

  /** Rebuild every row: fields in schema order, creator rows after title. */
  render(): void {
    const table = this._table;
    if (!table) {
      return;
    }
    this.clearValidationIssues();
    table.replaceChildren();
    this._focusedField = null;
    this._focusedExtraKey = null;
    this._extraRowElements = [];
    this._toolbar?.setTarget(null);
    this._pendingSizing = [];
    const item = this._item;
    if (!item?.isRegularItem()) {
      this._extra = null;
      return;
    }
    this.loadExtraDocument(item);

    const fragment = document.createDocumentFragment();
    const fieldNames = getFieldNames(item);
    const titleName = getTitleFieldName(item);
    const creatorsAfter = titleName ? fieldNames.indexOf(titleName) : -1;
    if (creatorsAfter === -1) {
      this.appendCreators(fragment, item);
    }
    for (let index = 0; index < fieldNames.length; index++) {
      this.appendFieldRow(fragment, item, fieldNames[index]);
      if (index === creatorsAfter) {
        this.appendCreators(fragment, item);
      }
    }
    this.appendExtraRows(fragment);
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
    this.attachSummary();
    this.syncLabelWidth();
    if (this._editable && titleName) {
      // Native note-editor buttons are available before a field is focused;
      // default the markup target to the title so the toolbar is not all
      // disabled until the user clicks a row.
      this._toolbar?.setTarget(
        this.querySelector<HTMLElement>(
          `editable-text[fieldname="${titleName}"]`,
        ),
      );
    } else {
      this._toolbar?.setTarget(null);
    }
    setTimeout(() => this.syncLabelWidth(), 0);
  }

  /** The summary lives in the sticky title row so it stays visible on scroll. */
  private attachSummary(): void {
    const summary = this._summary;
    const table = this._table;
    if (!summary || !table) return;
    const titleRow = table.querySelector<HTMLElement>(".title-row");
    if (titleRow) titleRow.prepend(summary);
    else table.prepend(summary);
    this.setValidationBannerVisible(!summary.hidden);
    this.updateFieldScrollMargin();
  }

  private setValidationBannerVisible(visible: boolean): void {
    this._table
      ?.querySelector(".title-row")
      ?.classList.toggle("has-validation-banner", visible);
  }

  private updateFieldScrollMargin(): void {
    const titleRow = this._table?.querySelector<HTMLElement>(".title-row");
    const height = titleRow?.getBoundingClientRect().height ?? 0;
    this.style.setProperty(
      "--field-scroll-margin",
      `${Math.ceil(height + 12)}px`,
    );
  }

  focusField(fieldName: string): void {
    this.querySelector<HTMLElement & { focus(): void }>(
      `editable-text[fieldname="${fieldName}"]`,
    )?.focus();
  }

  /**
   * Show one inline error line under every affected field and a compact summary
   * above the table. A single error focuses the field; multiple errors focus
   * the summary so the user can choose where to start.
   */
  showValidationIssues(issues: readonly FieldValidationIssue[]): {
    matched: number;
    total: number;
    unmatched: string[];
    focusTarget: HTMLElement | _ZoteroTypes.EditableText | null;
  } {
    this.clearValidationIssues();
    const targets = this.validationTargets();
    const affected = new Map<
      HTMLElement,
      { target: FieldTarget; messages: string[]; count: number }
    >();
    const unmatched: string[] = [];
    let errors = 0;

    for (const issue of issues) {
      if (issue.status === "error") errors++;
      const text = fieldIssueText(issue);
      const candidates = new Set<string>([
        issue.description,
        ...extractFieldCheckTargets(issue.description),
        ...extractFieldCheckTargets(issue.detail),
      ]);
      let matchedOne = false;
      for (const candidate of candidates) {
        const target = resolveFieldTarget(targets, candidate);
        if (!target) continue;
        let entry = affected.get(target.row);
        if (!entry) {
          entry = { target, messages: [], count: 0 };
          affected.set(target.row, entry);
        }
        entry.count++;
        if (!entry.messages.includes(text)) entry.messages.push(text);
        matchedOne = true;
        // Several fields can be valid alternatives ("pages" or an extra key);
        // mark the first one only so the summary is not padded with decoys.
        break;
      }
      if (!matchedOne) unmatched.push(text);
    }

    for (const [row, entry] of affected) {
      row.classList.add("has-field-error");
      this._validationTargets.set(row, {
        target: entry.target,
        count: entry.count,
      });
      entry.target.input.setAttribute("aria-invalid", "true");
      entry.target.input.ref?.setAttribute("aria-invalid", "true");
      this.addValidationMessage(entry.target, entry.messages);
    }

    this._validationIssueCount = issues.length;
    this._validationUnmatched = unmatched.length;
    this._validationErrors = errors;
    this.renderValidationSummary();

    const targetCount = this._validationTargets.size;
    let focusTarget: HTMLElement | _ZoteroTypes.EditableText | null = null;
    if (targetCount === 1 && !unmatched.length && !errors) {
      const entry = this._validationTargets.values().next().value;
      const target = entry?.target;
      if (target) {
        const input = target.input.ref ?? target.input;
        input.focus();
        target.row.scrollIntoView({ block: "nearest" });
        focusTarget = input;
      }
    } else if (targetCount || unmatched.length || errors) {
      const summary = this._summary;
      const firstItem = summary?.querySelector<HTMLButtonElement>(
        ".field-validation-summary-item",
      );
      if (summary && firstItem) {
        summary.scrollIntoView({ block: "nearest" });
        firstItem.focus();
        focusTarget = firstItem;
      }
    }

    return {
      matched: targetCount,
      total: issues.length,
      unmatched,
      focusTarget,
    };
  }

  /** Remove every field error marker, inline message and summary. */
  clearValidationIssues(): void {
    const rows = Array.from(
      this.querySelectorAll("#info-table .meta-row.has-field-error"),
    ) as HTMLElement[];
    for (const row of rows) this.removeRowValidationMarkers(row);
    this._validationTargets.clear();
    this._validationIssueCount = 0;
    this._validationUnmatched = 0;
    this._validationErrors = 0;
    const summary = this._summary;
    if (summary) {
      summary.hidden = true;
      summary.removeAttribute("role");
      this._summaryText?.replaceChildren();
      this._summaryItems?.replaceChildren();
      this._summaryNotices?.replaceChildren();
      this.setValidationBannerVisible(false);
      this.updateFieldScrollMargin();
    }
  }

  private clearRowValidation(row: HTMLElement): void {
    const entry = this._validationTargets.get(row);
    if (entry) this._validationIssueCount -= entry.count;
    this.removeRowValidationMarkers(row);
    this._validationTargets.delete(row);
    if (this._validationTargets.size || this._validationUnmatched) {
      this.renderValidationSummary();
    } else {
      this.clearValidationIssues();
    }
  }

  private removeRowValidationMarkers(row: HTMLElement): void {
    const entry = this._validationTargets.get(row);
    const target = entry?.target;
    const messages = Array.from(
      row.querySelectorAll(":scope > .field-validation-message"),
    ) as HTMLElement[];
    if (target) {
      target.input.removeAttribute("aria-invalid");
      target.input.ref?.removeAttribute("aria-invalid");
      for (const message of messages) {
        const id = message.id;
        if (!id) continue;
        this.toggleDescribedBy(target.input, id, false);
        if (target.input.ref) {
          this.toggleDescribedBy(target.input.ref, id, false);
        }
      }
    }
    for (const message of messages) message.remove();
    row.classList.remove("has-field-error");
  }

  private addValidationMessage(
    target: FieldTarget,
    messages: readonly string[],
  ): void {
    const message = document.createElement("div");
    message.className = "field-validation-message";
    message.id = `field-validation-${++this._validationSeq}`;
    const prefix = document.createElement("span");
    prefix.className = "field-validation-prefix";
    prefix.textContent = t("item-editor-validation-prefix");
    message.append(prefix, document.createTextNode(messages.join("\n\n")));
    target.row.appendChild(message);
    this.toggleDescribedBy(target.input, message.id, true);
    if (target.input.ref) {
      this.toggleDescribedBy(target.input.ref, message.id, true);
    }
  }

  private toggleDescribedBy(element: Element, id: string, add: boolean): void {
    const ids = new Set(
      (element.getAttribute("aria-describedby") ?? "")
        .split(/\s+/)
        .filter(Boolean),
    );
    if (add) ids.add(id);
    else ids.delete(id);
    if (ids.size) element.setAttribute("aria-describedby", [...ids].join(" "));
    else element.removeAttribute("aria-describedby");
  }

  private renderValidationSummary(): void {
    const summary = this._summary;
    const text = this._summaryText;
    const items = this._summaryItems;
    const notices = this._summaryNotices;
    if (!summary || !text || !items || !notices) return;
    const targets = [...this._validationTargets.values()].map(
      (entry) => entry.target,
    );
    const total = this._validationIssueCount;
    if (!total && !this._validationErrors) {
      summary.hidden = true;
      summary.removeAttribute("role");
      this.setValidationBannerVisible(false);
      this.updateFieldScrollMargin();
      return;
    }

    summary.hidden = false;
    this.setValidationBannerVisible(true);
    if (
      this._validationIssueCount > 1 ||
      this._validationUnmatched ||
      this._validationErrors
    ) {
      summary.setAttribute("role", "status");
    } else {
      summary.removeAttribute("role");
    }
    text.textContent = t("item-editor-validation-summary", {
      args: { count: total },
    });
    items.replaceChildren();
    for (const target of targets) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "field-validation-summary-item";
      button.textContent =
        target.label || target.input.getAttribute("fieldname");
      button.addEventListener("click", () => {
        const input = target.input.ref ?? target.input;
        input.focus();
        target.row.scrollIntoView({ block: "nearest" });
      });
      items.appendChild(button);
    }
    notices.replaceChildren();
    if (this._validationUnmatched) {
      const notice = document.createElement("span");
      notice.className = "field-validation-summary-notice";
      notice.textContent = t("item-editor-validation-summary-unmatched", {
        args: { count: this._validationUnmatched },
      });
      notices.appendChild(notice);
    }
    if (this._validationErrors) {
      const notice = document.createElement("span");
      notice.className = "field-validation-summary-notice";
      notice.textContent = t("item-editor-validation-summary-errors", {
        args: { count: this._validationErrors },
      });
      notices.appendChild(notice);
    }
    this.updateFieldScrollMargin();
  }

  private validationTargets(): Map<string, FieldTarget> {
    const targets = new Map<string, FieldTarget>();
    const add = (key: string, target: FieldTarget): void => {
      const text = key.trim();
      if (!text) return;
      targets.set(text.toLowerCase(), target);
      const normalized = normalizeExtraKey(text);
      if (normalized) targets.set(normalized, target);
    };

    const rows = Array.from(
      this._table?.querySelectorAll("#info-table .meta-row") ?? [],
    ) as HTMLElement[];
    for (const row of rows) {
      if (row.classList.contains("creator-section-row")) continue;
      if (row.classList.contains("extra-row")) {
        const key = row.querySelector<_ZoteroTypes.EditableText>(
          "editable-text[data-extra-key-id]",
        );
        const value = row.querySelector<_ZoteroTypes.EditableText>(
          "editable-text[data-extra-id]",
        );
        if (key && value && key.value.trim()) {
          add(key.value, { row, input: value, label: key.value.trim() });
        }
        continue;
      }
      if (row.classList.contains("extra-other-row")) {
        const other = row.querySelector<_ZoteroTypes.EditableText>(
          "editable-text[data-extra-other]",
        );
        if (other) {
          const label = Zotero.getString("itemFields.extra");
          const target = { row, input: other, label };
          add(label, target);
          add("extra", target);
        }
        continue;
      }
      const value = row.querySelector<_ZoteroTypes.EditableText>(
        "editable-text[fieldname]",
      );
      const fieldName = value?.getAttribute("fieldname");
      if (!value || !fieldName || fieldName.startsWith("creator-")) continue;
      const label =
        Zotero.ItemFields.getLocalizedString(fieldName) || fieldName;
      const target = { row, input: value, label };
      add(fieldName, target);
      add(label, target);
      const fieldID = Zotero.ItemFields.getID(fieldName);
      if (fieldID) {
        try {
          const baseID = Zotero.ItemFields.getBaseIDFromTypeAndField(
            this._item?.itemTypeID ?? 0,
            fieldID,
          );
          const baseName = baseID ? Zotero.ItemFields.getName(baseID) : "";
          if (baseName) add(baseName, target);
        } catch {
          // A primary column or an unknown type has no base field.
        }
      }
    }
    return targets;
  }

  /** Drop the toolbar target when focus moves to the creator editor. */
  clearToolbarTarget(): void {
    this._toolbar?.setTarget(null);
  }

  blurOpenField(): boolean {
    let blurred = false;
    if (this._focusedExtraKey) {
      this._focusedExtraKey.blur();
      this._focusedExtraKey = null;
      blurred = true;
    }
    const field = this._focusedField;
    if (field) {
      field.blur();
      blurred = true;
    }
    return blurred;
  }

  /**
   * Whether the focused field holds text that was never committed. A field
   * stays focused while the window is inactive (Zotero's `editable-text`
   * ignores that blur), so the draft alone cannot tell whether the user typed
   * something; the retarget path uses this to keep that input.
   */
  hasPendingEdit(): boolean {
    const key = this._focusedExtraKey;
    if (key && key.value.trim() !== key.initialValue.trim()) {
      return true;
    }
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
    const link = fieldExternalLink(fieldName, value);
    if (link) {
      data.appendChild(createOpenLinkButton(link));
    }
    const row = this.createRow(
      fieldName,
      Zotero.ItemFields.getLocalizedString(fieldName),
      data,
      field,
    );
    if (fieldName === getTitleFieldName(item)) {
      row.classList.add("title-row");
    }
    fragment.appendChild(row);
  }

  /** Load the editable extra document; keep one blank draft row for adding. */
  private loadExtraDocument(item: Zotero.Item): void {
    const parsed = parseExtraEditorDocument(
      String(item.getField("extra") || ""),
    );
    this._extra = {
      ...parsed,
      rows: parsed.rows.map((row) => ({
        ...row,
        id: this._nextExtraRowID++,
      })),
    };
    if (this._editable && this._extra.rows.length === 0) {
      this._extra.rows.push(this.createBlankExtraRow());
    }
  }

  private createBlankExtraRow(): EditableExtraRow {
    return {
      id: this._nextExtraRowID++,
      key: "",
      value: "",
      markable: false,
    };
  }

  /** Editable `extra` rows and the raw Other block, after the real fields. */
  private appendExtraRows(fragment: DocumentFragment): void {
    const document_ = this._extra;
    if (!document_) return;
    for (const row of document_.rows) {
      const element = this.createExtraRowElement(row);
      this._extraRowElements.push(element);
      fragment.appendChild(element);
    }
    const other = this.createExtraOtherRow(document_);
    this._extraRowElements.push(other);
    fragment.appendChild(other);
  }

  private createExtraRowElement(row: EditableExtraRow): HTMLDivElement {
    const element = document.createElement("div");
    element.className = "meta-row extra-row";
    element.dataset.extraRowId = String(row.id);

    const labelCell = document.createElement("div");
    labelCell.className = "meta-label";
    labelCell.setAttribute("fieldname", `extra-key-${row.id}`);
    labelCell.appendChild(this.createExtraKeyElement(row));

    const data = document.createElement("div");
    data.className = "meta-data";
    const valueInput = this.createFieldElement(`extra-${row.id}`, row.value, {
      "data-extra-id": String(row.id),
      "data-extra-markable": String(row.markable),
      nowrap: "true",
    });
    valueInput.classList.add("extra-value");
    data.appendChild(valueInput);
    if (this._editable) {
      data.appendChild(this.createExtraControls(row));
    }
    element.append(labelCell, data);
    return element;
  }

  private createExtraKeyElement(
    row: EditableExtraRow,
  ): _ZoteroTypes.EditableText {
    const element = document.createXULElement(
      "editable-text",
    ) as _ZoteroTypes.EditableText;
    element.classList.add("extra-key");
    element.setAttribute("nowrap", "true");
    element.setAttribute("tight", "true");
    element.setAttribute("fieldname", `extra-key-${row.id}`);
    element.setAttribute("data-extra-key-id", String(row.id));
    element.setAttribute("dir", "auto");
    element.placeholder = t("item-editor-extra-key-placeholder", {
      branch: "placeholder",
    });
    element.value = row.key;
    if (!this._editable) {
      element.setAttribute("readonly", "true");
      return element;
    }
    element.autocomplete = this.extraKeyAutocomplete(row);
    element.addEventListener("focusin", () =>
      this.onExtraKeyFocus(row, element),
    );
    element.addEventListener("focusout", () =>
      this.onExtraKeyBlur(row, element),
    );
    element.addEventListener("change", () => this.commitExtraKey(row, element));
    return element;
  }

  /**
   * Native `zotero-options` autocomplete, the same suggestion widget the item
   * pane uses for multi-value fields in batch editing.
   */
  private extraKeyAutocomplete(
    row: EditableExtraRow,
  ): _ZoteroTypes.EditableText.AutocompleteOptions {
    const document_ = this._extra;
    if (!document_) return {};
    const suggestions = getExtraKeySuggestions(document_.rows, "", row.key);
    return {
      minResultsForPopup: 1,
      noRollupOnEmptySearch: true,
      completeSelectedIndex: true,
      ignoreBlurWhileSearching: false,
      search: "zotero-options",
      searchParam: JSON.stringify({
        search: "zotero-options",
        options: suggestions,
      }),
      popup: "PopupAutoComplete",
    };
  }

  /** Rebuild every key input's suggestion options after rows change. */
  private refreshExtraKeyAutocomplete(): void {
    if (!this._extra) return;
    for (const row of this._extra.rows) {
      const element = this.extraKeyElement(row.id);
      if (element) element.autocomplete = this.extraKeyAutocomplete(row);
    }
  }

  private createExtraControls(row: EditableExtraRow): HTMLDivElement {
    const controls = document.createElement("div");
    controls.className = "extra-controls";
    controls.append(
      this.createExtraRowButton(
        "minus",
        Zotero.getString("general.delete"),
        () => this.removeExtraRow(row.id),
      ),
      this.createExtraRowButton(
        "plus",
        Zotero.getString("general.create"),
        () => this.addExtraRow(row.id),
      ),
    );
    return controls;
  }

  private createExtraRowButton(
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

  private createExtraOtherRow(
    document_: EditableExtraDocument,
  ): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "meta-row extra-other-row";

    const labelCell = document.createElement("div");
    labelCell.className = "meta-label";
    const label = document.createElement("label");
    label.className = "key";
    label.dir = "auto";
    label.textContent = Zotero.getString("itemFields.extra");
    labelCell.appendChild(label);

    const data = document.createElement("div");
    data.className = "meta-data";
    const field = document.createXULElement(
      "editable-text",
    ) as _ZoteroTypes.EditableText;
    field.classList.add("value", "extra-other");
    field.setAttribute("tight", "true");
    field.setAttribute("fieldname", "extra-other");
    field.setAttribute("multiline", "true");
    field.setAttribute("data-extra-other", "true");
    field.setAttribute("dir", "auto");
    field.placeholder = t("item-editor-extra-other-placeholder", {
      branch: "placeholder",
    });
    field.value = document_.other;
    if (!this._editable) {
      field.setAttribute("readonly", "true");
    } else {
      field.addEventListener("focusin", () => this.onFieldFocus(field));
      field.addEventListener("focusout", () => this.onFieldBlur(field));
    }
    data.appendChild(field);
    row.append(labelCell, data);
    return row;
  }

  private findExtraRow(id: number): EditableExtraRow | null {
    return this._extra?.rows.find((row) => row.id === id) ?? null;
  }

  private extraKeyElement(id: number): _ZoteroTypes.EditableText | null {
    return this.querySelector<_ZoteroTypes.EditableText>(
      `editable-text[data-extra-key-id="${id}"]`,
    );
  }

  private extraValueElement(id: number): _ZoteroTypes.EditableText | null {
    return this.querySelector<_ZoteroTypes.EditableText>(
      `editable-text[data-extra-id="${id}"]`,
    );
  }

  private focusExtraValue(id: number): void {
    const element = this.extraValueElement(id);
    element?.scrollIntoView({ block: "nearest" });
    element?.focus();
  }

  private onExtraKeyFocus(
    row: EditableExtraRow,
    element: _ZoteroTypes.EditableText,
  ): void {
    this._focusedExtraKey = element;
    this._toolbar?.setTarget(null);
    // `editable-text` only starts its autocomplete search on input; replay an
    // empty input after the focus settles so clicking a key row immediately
    // shows the suggestions. A fresh row may not have its autocomplete input
    // wired yet, so repeat once after the render tick.
    const startSearch = (): void => {
      if (this._focusedExtraKey !== element) return;
      element.ref?.dispatchEvent(new Event("input", { bubbles: true }));
    };
    startSearch();
    window.setTimeout(startSearch, 100);
  }

  private onExtraKeyBlur(
    row: EditableExtraRow,
    element: _ZoteroTypes.EditableText,
  ): void {
    if (this._focusedExtraKey === element) {
      this._focusedExtraKey = null;
    }
    this.commitExtraKey(row, element);
  }

  private commitExtraKey(
    row: EditableExtraRow,
    element: _ZoteroTypes.EditableText,
  ): void {
    const key = element.value.trim();
    if (!key) {
      if (row.value.trim()) {
        element.value = row.key;
      } else {
        row.key = "";
      }
      return;
    }
    if (!isValidExtraKey(key) || isManagedExtraKey(key)) {
      element.value = row.key;
      return;
    }
    if (key === row.key) {
      element.value = key;
      return;
    }
    row.key = key;
    row.markable = isMarkableExtraKey(key);
    const value = this.extraValueElement(row.id);
    value?.setAttribute("data-extra-markable", String(row.markable));
    if (this._focusedField === value) {
      this._toolbar?.setTarget(row.markable ? value : null);
    }
    this.refreshExtraKeyAutocomplete();
    this.writeExtraDocument();
  }

  private commitExtraValue(
    row: EditableExtraRow,
    element: _ZoteroTypes.EditableText,
    value: string,
  ): void {
    const next = value.trim();
    if (next === row.value) return;
    row.value = next;
    element.value = next;
    this.writeExtraDocument();
  }

  private commitExtraOther(value: string): void {
    const document_ = this._extra;
    if (!document_ || document_.other === value) return;
    document_.other = value;
    this.writeExtraDocument();
  }

  private writeExtraDocument(): void {
    const item = this._item;
    const document_ = this._extra;
    if (!item || !document_) return;
    const next = serializeExtraEditorDocument(document_);
    if (next === String(item.getField("extra") || "")) return;
    item.setField("extra", next);
    this._dirty = true;
  }

  private addExtraRow(afterID: number): void {
    if (!this._editable || !this._extra) return;
    this.blurOpenField();
    const rows = this._extra.rows;
    const position = rows.findIndex((row) => row.id === afterID);
    const row = this.createBlankExtraRow();
    rows.splice(position < 0 ? rows.length : position + 1, 0, row);
    this.renderExtraRows(row.id);
  }

  private removeExtraRow(id: number): void {
    if (!this._editable || !this._extra) return;
    this.blurOpenField();
    const rows = this._extra.rows;
    const position = rows.findIndex((row) => row.id === id);
    if (position < 0) return;
    rows.splice(position, 1);
    if (this._editable && rows.length === 0) {
      rows.push(this.createBlankExtraRow());
    }
    this.writeExtraDocument();
    const focusID = rows[position]?.id ?? rows[position - 1]?.id;
    this.renderExtraRows(focusID);
  }

  /** Rebuild only the extra section so fields keep focus and scroll. */
  private renderExtraRows(focusRowID?: number): void {
    for (const element of this._extraRowElements) {
      element.remove();
    }
    this._extraRowElements = [];
    const fragment = document.createDocumentFragment();
    this.appendExtraRows(fragment);
    this._table?.appendChild(fragment);
    this.syncLabelWidth();
    window.setTimeout(() => this.syncLabelWidth(), 0);
    if (focusRowID !== undefined) {
      const key = this.extraKeyElement(focusRowID);
      window.setTimeout(() => {
        key?.scrollIntoView({ block: "nearest" });
        key?.focus();
      }, 50);
    }
  }

  /** Place the external creator editor after the title row. */
  private appendCreators(fragment: DocumentFragment, item: Zotero.Item): void {
    if (this._creatorsHost) {
      const row = document.createElement("div");
      row.className = "meta-row creator-section-row";
      row.style.display = "block";
      row.style.gridColumn = "span 2";
      row.appendChild(this._creatorsHost);
      fragment.appendChild(row);
      return;
    }
    if (this._creatorsVisible) {
      this.appendCreatorRows(fragment, item);
    }
  }

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
    label.dir = "auto";
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
    if (
      !fieldName.startsWith("extra-") &&
      Zotero.ItemFields.isMultiline(fieldName)
    ) {
      element.setAttribute("multiline", "true");
    } else if (fieldName.startsWith("creator-")) {
      element.setAttribute("nowrap", "true");
    }
    for (const [key, attributeValue] of Object.entries(attributes)) {
      element.setAttribute(key, attributeValue);
    }
    if (this.isEditableField(fieldName)) {
      element.addEventListener("focusin", () => this.onFieldFocus(element));
      element.addEventListener("focusout", () => this.onFieldBlur(element));
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
    const extraID = element.hasAttribute("data-extra-id")
      ? Number(element.getAttribute("data-extra-id"))
      : Number.NaN;
    if (Number.isInteger(extraID)) {
      const row = this.findExtraRow(extraID);
      this._toolbar?.setTarget(row?.markable ? element : null);
      return;
    }
    if (element.hasAttribute("data-extra-other")) {
      this._toolbar?.setTarget(null);
      return;
    }
    const item = this._item;
    this._toolbar?.setTarget(
      item &&
        !fieldName.startsWith("creator-") &&
        isRichTextField(item, fieldName)
        ? element
        : null,
    );
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
    if (element.hasAttribute("data-extra-other")) {
      const value = element.value;
      if (value === element.initialValue) return;
      this.commitExtraOther(value);
      element.initialValue = value;
      return;
    }
    const extraID = element.hasAttribute("data-extra-id")
      ? Number(element.getAttribute("data-extra-id"))
      : Number.NaN;
    if (Number.isInteger(extraID)) {
      const row = this.findExtraRow(extraID);
      if (!row) return;
      const value = element.value.trim();
      if (value === element.initialValue.trim()) return;
      this.commitExtraValue(row, element, value);
      element.initialValue = value;
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
    this._dirty = true;
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

/** Width of an element's text content, independent of its laid-out box. */
function measureTextWidth(element: Element): number {
  const range = document.createRange();
  range.selectNodeContents(element);
  return range.getBoundingClientRect().width;
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

customElements.define("item-field-editor", ItemFieldEditor);
