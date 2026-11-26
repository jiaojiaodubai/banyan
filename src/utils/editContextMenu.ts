/** Native-looking edit actions for text fields in plugin-owned windows. */

export type EditMenuAction =
  "undo" | "redo" | "cut" | "copy" | "paste" | "delete" | "selectAll";

export type EditMenuExtraItem = {
  label: string;
  disabled?: boolean;
  command: () => void;
};

/**
 * Resolve the editable control from a `contextmenu` event target. Zotero's
 * `<editable-text>` retargets events from its internal input, so the target can
 * be the wrapper; its `ref` points at the real input.
 */
export function textInputFromEvent(
  target: Element | null,
): HTMLInputElement | HTMLTextAreaElement | null {
  const direct = target?.closest("input, textarea") as
    HTMLInputElement | HTMLTextAreaElement | null;
  if (direct) return direct;
  const ref = (target as { ref?: unknown } | null)?.ref;
  if (ref instanceof HTMLInputElement || ref instanceof HTMLTextAreaElement) {
    return ref;
  }
  return null;
}

/** Native item-pane edit actions, in the same order Gecko builds them. */
const EDIT_MENU_ITEMS: ReadonlyArray<{
  action: EditMenuAction;
  id: string;
  fallback: string;
}> = [
  { action: "undo", id: "menu_undo", fallback: "Undo" },
  { action: "redo", id: "menu_redo", fallback: "Redo" },
  { action: "cut", id: "menu_cut", fallback: "Cut" },
  { action: "copy", id: "menu_copy", fallback: "Copy" },
  { action: "paste", id: "menu_paste", fallback: "Paste" },
  { action: "delete", id: "menu_delete", fallback: "Delete" },
  { action: "selectAll", id: "menu_selectAll", fallback: "Select All" },
];

/** Mirrors a native menu item's label/accesskey, including its `(U)` hint. */
function nativeMenuItem(
  id: string,
  fallback: string,
): { label: string; accesskey: string | null } {
  const mainWindow = Zotero.getMainWindow?.() as Window | null;
  const element = mainWindow?.document?.getElementById(id);
  return {
    label: element?.getAttribute("label") ?? fallback,
    accesskey: element?.getAttribute("accesskey") ?? null,
  };
}

/** Replace the menu with the same edit actions Zotero's item pane uses. */
export function populateEditContextMenu(
  menu: XULMenuPopupElement,
  input: HTMLInputElement | HTMLTextAreaElement,
  extras: readonly EditMenuExtraItem[] = [],
): void {
  const hasSelection = input.selectionStart !== input.selectionEnd;
  menu.replaceChildren();

  const add = (action: EditMenuAction, id: string, fallback: string): void => {
    const native = nativeMenuItem(id, fallback);
    const item = document.createXULElement("menuitem");
    item.setAttribute("label", native.label);
    if (native.accesskey) {
      item.setAttribute("accesskey", native.accesskey);
    }
    item.disabled =
      action === "cut" || action === "copy" || action === "delete"
        ? !hasSelection
        : action === "paste"
          ? input.readOnly
          : action === "selectAll"
            ? !input.value
            : false;
    item.addEventListener("command", () => runEditMenuAction(input, action));
    menu.appendChild(item);
  };

  const undo = EDIT_MENU_ITEMS.slice(0, 2);
  const editing = EDIT_MENU_ITEMS.slice(2);
  for (const entry of undo) add(entry.action, entry.id, entry.fallback);
  menu.appendChild(document.createXULElement("menuseparator"));
  for (const entry of editing) add(entry.action, entry.id, entry.fallback);

  if (!extras.length) return;
  menu.appendChild(document.createXULElement("menuseparator"));
  for (const extra of extras) {
    const item = document.createXULElement("menuitem");
    item.setAttribute("label", extra.label);
    item.disabled = extra.disabled ?? false;
    item.addEventListener("command", extra.command);
    menu.appendChild(item);
  }
}

export function runEditMenuAction(
  input: HTMLInputElement | HTMLTextAreaElement,
  action: EditMenuAction,
): void {
  const start = input.selectionStart ?? 0;
  const end = input.selectionEnd ?? 0;
  const selected = input.value.slice(start, end);
  switch (action) {
    case "undo":
    case "redo":
      try {
        input.ownerDocument?.execCommand(action);
      } catch {
        // Chrome windows don't always expose edit commands; no-op.
      }
      break;
    case "copy":
      if (selected) Zotero.Utilities.Internal.copyTextToClipboard(selected);
      break;
    case "cut":
      if (selected) {
        Zotero.Utilities.Internal.copyTextToClipboard(selected);
        replaceSelection(input, start, end, "");
      }
      break;
    case "paste": {
      const text = Zotero.Utilities.Internal.getClipboard("text/plain") ?? "";
      if (text) replaceSelection(input, start, end, text);
      break;
    }
    case "delete":
      if (start !== end) replaceSelection(input, start, end, "");
      break;
    case "selectAll":
      input.select();
      break;
  }
  input.focus();
}

function replaceSelection(
  input: HTMLInputElement | HTMLTextAreaElement,
  start: number,
  end: number,
  text: string,
): void {
  input.setRangeText(text, start, end, "end");
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
