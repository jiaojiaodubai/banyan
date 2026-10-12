/** The library selection that every item-menu entry is computed from. */
export type RegularSelection = {
  /** Whether the current view allows edits (trash, read-only groups). */
  canEdit: boolean;
  /** Selected entries, without notes and attachments. */
  items: Zotero.Item[];
  /** Raw selection length, so callers can tell items from child entries. */
  selectedCount: number;
};

export function getRegularSelection(): RegularSelection {
  const pane = Zotero.getActiveZoteroPane();
  // An empty selection keeps a missing pane from throwing inside `onShowing`,
  // which would abort Zotero's whole context-menu build.
  if (!pane) {
    return { canEdit: false, items: [], selectedCount: 0 };
  }
  const selection = pane.getSelectedItems();
  return {
    canEdit: pane.canEdit(),
    items: selection.filter((item) => item.isRegularItem()),
    // Lets callers tell "one item" from "one item plus a note/attachment".
    selectedCount: selection.length,
  };
}
