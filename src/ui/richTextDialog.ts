import { RichTextEditor } from "./richTextEditor";
import { markupFromRichText, richTextFromMarkup } from "./richTextMarkup";
import { useL10n } from "../utils/locale";

const t = useL10n(["richTextEditor.ftl"]);

export type RichTextDialogOptions = {
  value: string;
  title?: string;
  onCommit: (markup: string) => void;
};

/**
 * Minimal modal editor for one rich-text value.
 *
 * It reuses the same `RichTextEditor` as the bibliography line editor and keeps
 * the value in memory until the user confirms; cancel and Escape discard it.
 */
export function openRichTextDialog({
  value,
  title,
  onCommit,
}: RichTextDialogOptions): void {
  const overlay = document.createElement("div");
  overlay.className = "banyan-richtext-dialog-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  const dialog = document.createElement("div");
  dialog.className = "banyan-richtext-dialog";

  const heading = document.createElement("div");
  heading.className = "banyan-richtext-dialog-title";
  heading.textContent = title ?? t("richtext-dialog-title");

  const editorHost = document.createElement("div");
  editorHost.className = "banyan-richtext-dialog-editor";
  const editor = new RichTextEditor(editorHost);
  editor.setRichText(richTextFromMarkup(value));

  const actions = document.createElement("div");
  actions.className = "dialog-footer banyan-richtext-dialog-actions";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = t("richtext-dialog-cancel");

  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.setAttribute("default", "true");
  confirm.textContent = t("richtext-dialog-confirm");

  const close = () => {
    document.removeEventListener("keydown", onKeydown, true);
    overlay.remove();
    if (previousFocus && typeof previousFocus.focus === "function") {
      previousFocus.focus();
    }
  };
  const commit = () => {
    const markup = markupFromRichText(editor.getRichText());
    close();
    onCommit(markup);
  };

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      commit();
    }
  };

  cancel.addEventListener("click", close);
  confirm.addEventListener("click", commit);
  // Keep clicks inside from reaching the overlay's backdrop handler.
  dialog.addEventListener("click", (event) => event.stopPropagation());
  overlay.addEventListener("click", close);

  actions.append(cancel, confirm);
  dialog.append(heading, editorHost, actions);
  overlay.appendChild(dialog);

  const previousFocus = document.activeElement as HTMLElement | null;
  document.addEventListener("keydown", onKeydown, true);
  if (!document.body) {
    document.removeEventListener("keydown", onKeydown, true);
    return;
  }
  document.body.appendChild(overlay);
  editorHost.querySelector<HTMLElement>(".banyan-richtext-editor")?.focus();
}
