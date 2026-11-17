import { openChildDialog } from "../utils/window";
import { createLogger } from "../utils/logger";

const log = createLogger("rich-text-dialog");

export type RichTextDialogOptions = {
  /** Stored markup to edit. */
  value: string;
  /** Parameter label, shown as the native window title. */
  title: string;
};

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

/**
 * Edit one rich-text value in its own dialog window.
 *
 * The window owns the toolbar, the editing surface, and the shared footer, so
 * the value can use the full width the way Zotero's note editor does. It keeps
 * the edited markup in memory until the user confirms; Escape, the close
 * button, and Cancel all discard it. Resolves to `null` when discarded.
 */
export function openRichTextDialog({
  value,
  title,
}: RichTextDialogOptions): Promise<string | null> {
  const previousFocus = document.activeElement as HTMLElement | null;
  return new Promise<string | null>((resolve) => {
    const io: RichTextDialogIO = {
      value,
      title,
      result: null,
      deferred: {
        promise: Promise.resolve(),
        resolve: () => {
          resolve(io.result);
        },
      },
    };

    try {
      const win = openChildDialog(
        `chrome://${addon.data.config.addonRef}/content/richTextDialog.xhtml`,
        "modal,resizable=yes,width=560,height=360",
        io,
      );
      // Restore the trigger after the modal loop returns. The dialog resolves
      // `io.deferred` before it closes, so this also runs for any exit path.
      win.addEventListener("unload", () => {
        if (previousFocus && typeof previousFocus.focus === "function") {
          previousFocus.focus();
        }
      });
    } catch (error) {
      log.error("could not open the rich text dialog", error);
      resolve(null);
    }
  });
}
