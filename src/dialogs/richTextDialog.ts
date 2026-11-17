import { RichTextEditor } from "../ui/richTextEditor";
import { markupFromRichText, richTextFromMarkup } from "../ui/richTextMarkup";
import { useL10n } from "../utils/locale";
import { unwrapDialogIO } from "../utils/window";
import { createLogger } from "../utils/logger";

const log = createLogger("rich-text-dialog");

const t = useL10n(["richTextEditor.ftl"]);

/** What the dialog window reads from `window.arguments[0]`. */
type RichTextDialogIO = {
  value: string;
  title: string;
  result: string | null;
  deferred: {
    promise: Promise<void>;
    resolve: () => void;
  };
};

let io: RichTextDialogIO | null = null;
let editor: RichTextEditor | null = null;
let resolved = false;

window.addEventListener("load", initRichTextDialog);
window.addEventListener("unload", () => {
  if (!resolved && io) {
    io.result = null;
    io.deferred.resolve();
  }
});

function initRichTextDialog(): void {
  const arg = unwrapDialogIO<RichTextDialogIO>(window.arguments?.[0]);
  if (!arg) {
    log.error("window IO is missing");
    return;
  }
  io = arg;

  // A form dialog keeps the native title bar, so the title is the parameter
  // being edited; no in-content heading competes with it.
  document.title = String(io.title || t("richtext-dialog-title"));

  const host = document.getElementById(
    "rich-text-editor",
  ) as HTMLElement | null;
  if (!host) {
    log.error("editor host is missing");
    return;
  }
  editor = new RichTextEditor(host);
  editor.setRichText(richTextFromMarkup(io.value));
  bindEvents();
  editor.focusAtEnd();
}

function bindEvents(): void {
  document.getElementById("accept-button")?.addEventListener("click", onAccept);
  document.getElementById("cancel-button")?.addEventListener("click", onCancel);
  document.addEventListener("keydown", onKeydown);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    onCancel();
    return;
  }
  // Plain Enter keeps inserting a line break in the editor; only the explicit
  // chord commits, matching the editor's previous behaviour.
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    event.stopPropagation();
    onAccept();
  }
}

function onAccept(): void {
  if (!io || !editor) return;
  io.result = markupFromRichText(editor.getRichText());
  resolved = true;
  io.deferred.resolve();
  window.close();
}

function onCancel(): void {
  if (!io) return;
  io.result = null;
  resolved = true;
  io.deferred.resolve();
  window.close();
}
