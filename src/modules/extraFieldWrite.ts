import { openDialogWindow } from "../utils/window";
import { getLocaleID, useL10n } from "../utils/locale";
import { showSimpleMessage } from "../utils/message";
import { getRegularSelection } from "../utils/selection";
import {
  isValidExtraKey,
  normalizeExtraKey,
  toTitleCaseExtraKey,
} from "@banyan/core/items/extra";
import {
  analyzeExtraField,
  mergeExtraField,
  needsConflictDecision,
} from "@banyan/core/items/extraField";
import type { ItemMenuContribution } from "../../typings/menu";
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
    log.error("恢复条目失败", error);
  }
  restoreFallback();
}

export const writeExtraFieldItemMenu: ItemMenuContribution = {
  id: "write-extra-field",
  build() {
    return [
      {
        menuType: "menuitem",
        l10nID: getLocaleID("menuitem-write-extra-field"),
        onShowing: (_event, context) => {
          const { canEdit, items } = getRegularSelection();
          context.setVisible(canEdit && items.length > 0);
        },
        onCommand: () => {
          void openWriteExtraFieldDialog();
        },
      },
    ];
  },
};

async function openWriteExtraFieldDialog(): Promise<void> {
  const pane = Zotero.getActiveZoteroPane();
  if (!pane) {
    return;
  }
  const selectedItems = pane
    .getSelectedItems()
    .filter((item) => item.isRegularItem());

  if (selectedItems.length === 0) {
    return;
  }

  return new Promise((resolve) => {
    const io: ExtraFieldDialogIO = {
      result: null,
      deferred: {
        promise: Promise.resolve(),
        resolve: async () => {
          if (io.result) {
            try {
              await batchWriteExtraField(selectedItems, io.result);
            } catch (e) {
              log.error("批量写入 extra 字段失败", e);
              showSimpleMessage(
                t("extra-field-write-failed", {
                  args: {
                    message: e instanceof Error ? e.message : String(e),
                  },
                }),
              );
            }
          }
          resolve();
        },
      },
    };

    openExtraFieldDialog(io);
  });
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
 * Write one key to many items, asking once per conflicting value.
 */
async function batchWriteExtraField(
  items: Zotero.Item[],
  payload: ExtraFieldDialogResult,
): Promise<void> {
  // Write keys in Zotero's preferred title-case form (e.g. "Type",
  // "Citation Key"); matching still uses the lowercase kebab normalization.
  const writeKey = toTitleCaseExtraKey(payload.key);
  const value = payload.value;
  const normalizedKey = normalizeExtraKey(writeKey);
  if (!normalizedKey || !isValidExtraKey(payload.key)) {
    showSimpleMessage(t("extra-field-error-invalid-key"));
    return;
  }

  let autoAction: Exclude<ConflictAction, "cancel"> | null = null;
  let updatedCount = 0;
  let skippedCount = 0;
  let aborted = false;

  for (const item of items) {
    const originalExtra = String(item.getField("extra") || "");
    const analysis = analyzeExtraField(originalExtra, normalizedKey);
    const alreadyWritten =
      analysis.values.length === 1 && analysis.values[0] === value;

    // Re-applying the value already there is a no-op; skip before asking so
    // the write neither prompts nor reorders `extra` (pairs move to the top
    // block, which would otherwise touch an item that needs no change).
    if (!alreadyWritten && needsConflictDecision(analysis.values, value)) {
      let action: ConflictAction;
      if (autoAction) {
        action = autoAction;
      } else {
        const decision = promptExtraConflict(
          item,
          writeKey,
          analysis.values,
          value,
        );
        if (decision.action === "cancel") {
          aborted = true;
          break;
        }
        if (decision.applyToRemaining) {
          autoAction = decision.action;
        }
        action = decision.action;
      }

      if (action === "skip") {
        skippedCount++;
        continue;
      }
    } else if (alreadyWritten) {
      skippedCount++;
      continue;
    }

    const nextExtra = mergeExtraField(
      originalExtra,
      writeKey,
      normalizedKey,
      value,
    );

    if (nextExtra === originalExtra) {
      skippedCount++;
      continue;
    }

    item.setField("extra", nextExtra);
    try {
      await item.saveTx();
    } catch (error) {
      // The item keeps only what is stored: the write never happened.
      await recoverItemAfterFailedSave(item, () => {
        item.setField("extra", originalExtra);
      });
      throw error;
    }
    updatedCount++;
  }

  showSimpleMessage(
    t("extra-field-write-summary", {
      args: {
        updated: updatedCount,
        skipped: skippedCount,
        failed: 0,
        aborted: aborted ? 1 : 0,
      },
    }),
  );
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
