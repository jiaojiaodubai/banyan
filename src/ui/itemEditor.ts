import "./itemFieldEditor";
import "./creatorEditor";
import type { ItemFieldEditor } from "./itemFieldEditor";
import type { FieldValidationIssue } from "../utils/itemFieldCheckText";
import type { CreatorEditor } from "./creatorEditor";

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const TOOLBAR_MIN_WIDTH = 240;

/**
 * The full item editor: the field editor (fields, extra pairs, markup toolbar)
 * and the creator editor composed together. It owns no window or save policy;
 * the dialog does that.
 *
 * Hosts only need to place `<item-editor>`; the two child editors are created
 * here when the host markup does not provide them. That keeps the composition
 * shared by the item dialog and the multilingual dialog instead of making each
 * host know the internal element names.
 */
export class ItemEditor extends XULElement {
  private _fieldEditor: ItemFieldEditor | null = null;
  private _creatorEditor: CreatorEditor | null = null;
  private _item: Zotero.Item | null = null;
  private _editable = true;

  get item(): Zotero.Item | null {
    return this._item;
  }

  get editable(): boolean {
    return this._editable;
  }

  set editable(value: boolean) {
    if (this._editable === value) return;
    this._editable = value;
    if (this._fieldEditor) this._fieldEditor.editable = value;
    if (this._creatorEditor) this._creatorEditor.editable = value;
  }

  get dirty(): boolean {
    return Boolean(this._fieldEditor?.dirty || this._creatorEditor?.dirty);
  }

  /**
   * Natural content width of the whole editor. The dialog adds its window
   * chrome; a host that embeds the editor (the multilingual dialog) can give
   * the pane this minimum without duplicating the measurement.
   */
  get contentMinWidth(): number {
    let labelWidth = 0;
    for (const label of this.querySelectorAll<HTMLElement>(
      "#info-table .meta-label",
    )) {
      labelWidth = Math.max(labelWidth, label.getBoundingClientRect().width);
    }

    const toolbar = this.querySelector<HTMLElement>(".field-markup-toolbar");
    const toolbarWidth = toolbar
      ? Math.max(
          TOOLBAR_MIN_WIDTH,
          Array.from(toolbar.children).reduce(
            (width, child) =>
              width + (child as HTMLElement).getBoundingClientRect().width,
            0,
          ),
        )
      : TOOLBAR_MIN_WIDTH;

    return Math.ceil(
      Math.max(
        360,
        toolbarWidth + 8,
        labelWidth + 120,
        this._creatorEditor?.contentMinWidth ?? 0,
      ),
    );
  }

  connectedCallback(): void {
    this.ensureChildren();
    // The parser connects a custom element before inserting its children, so
    // the first lookup can race the markup; retry once the subtree exists.
    if (!this._fieldEditor) {
      window.setTimeout(() => this.ensureChildren(), 0);
    }
  }

  private ensureChildren(): void {
    if (this._fieldEditor && this._creatorEditor) return;

    const doc = this.ownerDocument ?? document;
    let fieldEditor = this.querySelector(
      "item-field-editor",
    ) as ItemFieldEditor | null;
    let creatorEditor = this.querySelector(
      "creator-editor",
    ) as CreatorEditor | null;

    if (!fieldEditor) {
      fieldEditor = doc.createElementNS(
        XUL_NS,
        "item-field-editor",
      ) as ItemFieldEditor;
      this.appendChild(fieldEditor);
    }
    if (!creatorEditor) {
      creatorEditor = doc.createElementNS(
        XUL_NS,
        "creator-editor",
      ) as CreatorEditor;
      this.appendChild(creatorEditor);
    }

    fieldEditor.creatorsVisible = false;
    fieldEditor.creatorsHost = creatorEditor;
    this._fieldEditor = fieldEditor;
    this._creatorEditor = creatorEditor;
    creatorEditor.addEventListener("focusin", () => {
      fieldEditor.clearToolbarTarget();
    });
    if (this._item) this.configure(this._item, this._editable);
  }

  /** Point both halves at one item with a single rebuild each. */
  configure(item: Zotero.Item | null, editable: boolean): void {
    this._item = item;
    this._editable = editable;
    this._fieldEditor?.configure(item, editable);
    if (item) this._creatorEditor?.configure(item, editable);
  }

  focusField(fieldName: string): void {
    this._fieldEditor?.focusField(fieldName);
  }

  focusCreator(index: number): void {
    this._creatorEditor?.focusCreator(index);
  }

  /** Mark and focus the fields named by non-passing item-field checks. */
  showValidationIssues(issues: readonly FieldValidationIssue[]): {
    matched: number;
    total: number;
    unmatched: string[];
    focusTarget: HTMLElement | _ZoteroTypes.EditableText | null;
  } {
    return (
      this._fieldEditor?.showValidationIssues(issues) ?? {
        matched: 0,
        total: issues.length,
        unmatched: [],
        focusTarget: null,
      }
    );
  }

  clearValidationIssues(): void {
    this._fieldEditor?.clearValidationIssues();
  }

  blurOpenField(): boolean {
    const fields = this._fieldEditor?.blurOpenField() ?? false;
    const creators = this._creatorEditor?.blurOpenField() ?? false;
    return fields || creators;
  }

  hasPendingEdit(): boolean {
    return (
      (this._fieldEditor?.hasPendingEdit() ?? false) ||
      (this._creatorEditor?.dirty ?? false)
    );
  }

  /** Write the creator drafts into `item`; fields are already in memory. */
  applyCreatorsTo(item: Zotero.Item): void {
    this._creatorEditor?.applyToItem(item);
  }
}

customElements.define("item-editor", ItemEditor);
