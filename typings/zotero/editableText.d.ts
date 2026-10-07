/**
 * Zotero `<editable-text>` element (`chrome/content/zotero/elements/editableText.js`).
 *
 * Registered at runtime by `customElements.js`, so it has no lib typing; only
 * the surface this plugin touches is declared.
 */
declare namespace _ZoteroTypes {
  interface EditableText extends XULElement {
    value: string;
    placeholder: string;
    cancelled?: boolean;
    multiline: boolean;
    readOnly: boolean;
    noWrap: boolean;
    dir: string;
    minLines: number;
    maxLines: number;
    /** Tooltip text; `itemBox.js` sets it to a date's stored SQL value. */
    tooltipText: string;
    /** The value a field held when it was focused; empty when not focused. */
    initialValue: string;
    autocomplete: _ZoteroTypes.EditableText.AutocompleteOptions | null;
    /** Set by the reader for creator autocomplete; see `itemBox.js`. */
    onTextEntered?: () => boolean;
    focus(): void;
    blur(): boolean;
    select(): void;
    /** Cap the width at the text's own width (`editableText.js`). */
    sizeToContent: () => void;
  }

  namespace EditableText {
    interface AutocompleteOptions {
      completeSelectedIndex?: boolean;
      ignoreBlurWhileSearching?: boolean;
      search?: string;
      searchParam?: string;
      popup?: string;
    }
  }
}

/**
 * `editable-text` is a custom element, so the lib `createXULElement()` returns
 * a generic `Element`; narrow it to the element interface.
 */
interface Document {
  createXULElement(name: "editable-text"): _ZoteroTypes.EditableText;
  createXULElement(name: "toolbarbutton"): XULToolBarButtonElement;
}

/**
 * Zotero's element classes extend `XULElement`, which the lib's
 * `CustomElementConstructor` rejects; widened so registration needs no cast.
 */
declare let customElements: CustomElementRegistry;

type XULElementConstructor = new () => XULElement;

interface CustomElementRegistry {
  define(name: string, constructor: XULElementConstructor): void;
  get(name: string): XULElementConstructor | undefined;
  whenDefined(name: string): Promise<XULElementConstructor>;
}
