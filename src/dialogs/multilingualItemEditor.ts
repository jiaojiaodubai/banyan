import { ItemFieldEditor } from "../ui/itemFieldEditor";

/**
 * Multilingual dialog's item editor: the shared field table plus the same
 * markup toolbar. Kept as a named subclass so the dialog's element name and
 * imports stay stable while both windows share one implementation.
 */
export class MultilingualItemEditor extends ItemFieldEditor {}

customElements.define("multilingual-item-editor", MultilingualItemEditor);
