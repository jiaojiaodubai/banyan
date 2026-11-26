import { openDialogWindow } from "../utils/window";
import { useL10n } from "../utils/locale";
import { createLogger } from "../utils/logger";

const log = createLogger("extra-field-write");

const t = useL10n(["mainWindow.ftl"]);

type ExtraFieldDialogResult = {
  key: string;
  value: string;
};

/** What the write dialog reads from `window.arguments[0]`. */
type ExtraFieldDialogIO = {
  initialKey?: string;
  initialValue?: string;
  lockKey?: boolean;
  hint?: string;
  result: ExtraFieldDialogResult | null;
  deferred: {
    promise: Promise<void>;
    resolve: () => void;
  };
};

function openExtraFieldDialog(io: ExtraFieldDialogIO): void {
  openDialogWindow(
    `chrome://${addon.data.config.addonRef}/content/extraFieldDialog.xhtml`,
    "modal,resizable=yes",
    io,
  );
}

export type ConflictAction = "skip" | "overwrite" | "cancel";

export type ConflictDecision = {
  action: ConflictAction;
  applyToRemaining: boolean;
};

/**
 * Put an item back to the state the database holds after a failed save: reload
 * and clear the change log, as Zotero's own save-failure recovery does.
 * `restoreFallback` covers an environment where reloading is unavailable.
 */
export async function recoverItemAfterFailedSave(
  item: Zotero.Item,
  restoreFallback: () => void,
): Promise<void> {
  try {
    await item.reload(null, true);
    item._clearChanged();
    return;
  } catch (error) {
    log.error("Failed to restore item", error);
  }
  restoreFallback();
}

/** Ask for one field's value with its key fixed, reusing the write dialog. */
export async function promptExtraFieldValue(options: {
  key: string;
  hint: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    const io: ExtraFieldDialogIO = {
      initialKey: options.key,
      lockKey: true,
      hint: options.hint,
      result: null,
      deferred: {
        promise: Promise.resolve(),
        resolve: () => {
          resolve(io.result?.value ?? null);
        },
      },
    };

    openExtraFieldDialog(io);
  });
}

/**
 * Short label of an item for prompt text: its title when it has one, otherwise
 * Zotero's own display title (creator/date), otherwise the item key.
 */
export function getItemPromptLabel(item: Zotero.Item): string {
  return (
    String(item.getField("title") || "").trim() ||
    String(item.getDisplayTitle?.() || "").trim() ||
    item.key
  );
}

/**
 * Ask what to do about a value that is already there, naming the item, the key
 * and both values. The buttons are localized by the plugin.
 */
export function promptExtraConflict(
  item: Zotero.Item,
  writeKey: string,
  existingValues: string[],
  newValue: string,
): ConflictDecision {
  const checkState = { value: false };
  const itemLabel = getItemPromptLabel(item);
  const existingText = existingValues.join("; ");

  const selected = Zotero.Prompt.confirm({
    window: Zotero.getMainWindow(),
    title: t("extra-field-conflict-title"),
    text: t("extra-field-conflict-message", {
      args: {
        item: itemLabel,
        key: writeKey,
        existing: existingText,
        newValue,
      },
    }),
    button0: t("extra-field-conflict-skip"),
    button1: t("extra-field-conflict-overwrite"),
    button2: t("extra-field-conflict-cancel"),
    checkLabel: t("extra-field-conflict-apply-to-remaining"),
    checkbox: checkState,
  });

  if (selected === 0) {
    return { action: "skip", applyToRemaining: checkState.value };
  }
  if (selected === 1) {
    return { action: "overwrite", applyToRemaining: checkState.value };
  }
  return { action: "cancel", applyToRemaining: false };
}
