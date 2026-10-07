import { openDialogWindow } from "./server";
import {
  collectRelatableItems,
  getMultilingualUris,
  relateItemsWithinTransaction,
} from "./relations";
import { useL10n } from "../utils/locale";
import {
  createKeyedQueue,
  runMultilingualCommit,
} from "../utils/multilingualCommit";
import { unwrapMultilingualDialogIO } from "../utils/multilingualDialogIO";
import {
  findExistingLanguageItem,
  isSameItemContent,
  normalizeLanguageCode,
  reloadItemContent,
  snapshotItemContent,
  type LanguageItemCandidate,
} from "../utils/multilingualDraft";
import { findWindowByName, isWindowAlive } from "../utils/window";
import type { ItemContentSnapshot } from "../../typings/multilingualItem";
import type {
  MultilingualCommitResult,
  MultilingualItemDialogIO,
} from "../../typings/multilingualItemDialog";

const t = useL10n(["multilingualItemDialog.ftl"]);

// Must match the dialog's root element id in `multilingualItemDialog.xhtml`.
export const DIALOG_WINDOW_NAME = "banyan-multilingual-item-dialog";

// Serialize commits per source and language: a copy is linked only in
// `relate()`, after its save, so a parallel check could create a twin.
const enqueueCommit = createKeyedQueue();

/**
 * Persist in the plugin realm so the save outlives the dialog; never throws.
 */
export async function commitMultilingualDraft(
  source: Zotero.Item,
  draft: Zotero.Item,
  sourceContent: ItemContentSnapshot,
): Promise<MultilingualCommitResult> {
  const language = normalizeLanguageCode(draft.getField("language")) ?? "";
  return enqueueCommit(`${source.libraryID}\t${source.key}\t${language}`, () =>
    runMultilingualCommit({
      commit: async () => {
        // Set to now: a retry leaves it stale and empty is rejected.
        const now = Zotero.Date.dateToSQL(new Date(), true);
        draft.dateAdded = now;
        draft.dateModified = now;
        let duplicateItem: Zotero.Item | null = null;
        let skippedPairs = 0;
        let related: Zotero.Item[] = [];
        try {
          // One transaction for the whole write: the source is re-read, the
          // language re-checked, and the copy saved and linked as one unit, so
          // a failure leaves neither an unlinked copy nor a partial group.
          await Zotero.DB.executeTransaction(async () => {
            const stored = await requireCurrentSource(source, sourceContent);
            duplicateItem = await findDuplicateLanguageItem(stored, language);
            if (duplicateItem) {
              return;
            }
            await draft.save({ skipSelect: true });
            const result = await relateItemsWithinTransaction([stored, draft], {
              onError: "throw",
            });
            related = result.relatedItems;
            skippedPairs = result.skippedPairs;
            if (
              !getMultilingualUris(draft).includes(
                Zotero.URI.getItemURI(stored),
              )
            ) {
              throw new Error(t("multilingual-item-error-relate"));
            }
          });
        } catch (error) {
          // The rollback restores the database, not the objects: put the items
          // the transaction wrote back on the stored values, or a later save
          // writes the relations the rollback undid.
          await restoreStoredState([source, ...related]);
          throw error;
        }
        if (duplicateItem) {
          return { ok: false, duplicateItem };
        }
        return {
          ok: true,
          item: draft,
          ...(skippedPairs
            ? {
                notice: t("multilingual-item-notice-skipped-members", {
                  args: { count: skippedPairs },
                }),
              }
            : {}),
        };
      },
      logError: (error) => ztoolkit.logError(error),
      fallbackMessage: t("multilingual-item-error-save"),
    }),
  );
}

/**
 * Put items back on their stored state after a rolled-back transaction: Zotero
 * keeps in-memory relations and content, including writes the rollback undid.
 */
async function restoreStoredState(items: Zotero.Item[]): Promise<void> {
  const seen = new Set<number>();
  for (const item of items) {
    if (!item?.id || seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    try {
      await item.loadDataType("relations");
      await reloadItemContent(item);
    } catch (error) {
      ztoolkit.logError(error);
    }
  }
}

/** The stored source, or a throw when gone, not editable, or changed. */
async function requireCurrentSource(
  source: Zotero.Item,
  sourceContent: ItemContentSnapshot,
): Promise<Zotero.Item> {
  const stored = await Zotero.Items.getByLibraryAndKeyAsync(
    source.libraryID,
    source.key,
    { noCache: true },
  );
  if (stored === false) {
    throw new Error(t("multilingual-item-error-source-changed"));
  }
  try {
    await reloadItemContent(stored);
  } catch (error) {
    ztoolkit.logError(error);
    throw new Error(t("multilingual-item-error-source-changed"), {
      cause: error,
    });
  }
  if (
    stored.deleted ||
    !stored.isEditable() ||
    !isSameItemContent(snapshotItemContent(stored), sourceContent)
  ) {
    throw new Error(t("multilingual-item-error-source-changed"));
  }
  return stored;
}

/** An existing copy with this language, reached across the whole group. */
async function findDuplicateLanguageItem(
  source: Zotero.Item,
  language: string,
): Promise<Zotero.Item | null> {
  const group = await collectRelatableItems([source], {
    refreshRelations: true,
  });
  await Promise.all(group.map((item) => reloadItemContent(item)));
  const candidates: LanguageItemCandidate<Zotero.Item>[] = group.map(
    (item) => ({
      item,
      language: item.getField("language"),
      deleted: item.deleted,
    }),
  );
  return findExistingLanguageItem(candidates, language);
}

/** Attach the plugin-realm commit entry point; publishes to `io.result`. */
function attachCommit(io: MultilingualItemDialogIO): void {
  io.commit = (source, draft, sourceContent) => {
    const pending = commitMultilingualDraft(source, draft, sourceContent).then(
      (outcome) => {
        if (outcome.ok) {
          io.result = outcome.item;
        }
        return outcome;
      },
    );
    io.commitPending = pending;
    return pending;
  };
}

/** Resolve the opener's deferred on close, after any in-flight commit. */
async function settleOnClose(io: MultilingualItemDialogIO): Promise<void> {
  if (io.commitPending) {
    try {
      await io.commitPending;
    } catch {
      // `commitMultilingualDraft` never rejects; ignore unexpected failures.
    }
  }
  io.deferred.resolve();
}

export async function openCreateMultilingualItemDialog(
  sourceItem: Zotero.Item,
): Promise<void> {
  if (!sourceItem.isRegularItem() || !sourceItem.isEditable()) {
    return;
  }

  const io: MultilingualItemDialogIO = {
    sourceItem,
    result: null,
    deferred: { resolve: () => undefined },
    findDuplicate: (source, language) =>
      findDuplicateLanguageItem(source, language),
  };
  attachCommit(io);

  // One editor per source item; also finds reload leftovers.
  const existing = findWindowByName(DIALOG_WINDOW_NAME);
  if (existing && isWindowAlive(existing)) {
    await retargetExistingWindow(existing, io);
    await handleDialogResult(io, sourceItem);
    return;
  }

  await new Promise<void>((resolve) => {
    io.deferred.resolve = resolve;
    const url = `chrome://${addon.data.config.addonRef}/content/multilingualItemDialog.xhtml`;
    // Zotero's recipe for resizable utility windows: open with `dialog=no` to
    // keep native controls; `openDialogWindow` covers a missing main window.
    // The window name makes the dialog findable before its document is parsed,
    // so a second trigger cannot open a second editor.
    const features = "chrome,dialog=no,resizable=yes";
    const win =
      Zotero.getMainWindow()?.openDialog(
        url,
        DIALOG_WINDOW_NAME,
        features,
        io,
      ) ?? openDialogWindow(url, "dialog=no,resizable", io, DIALOG_WINDOW_NAME);
    // The window unloads its initial `about:blank` document while it navigates
    // to the dialog, long before the dialog script installs `io.reload`; only
    // an unload after that means the dialog is really gone. Settling there
    // would hand the opener a result-less session while the dialog saves.
    const onUnload = () => {
      if (typeof io.reload !== "function") {
        win.addEventListener("unload", onUnload, { once: true });
        return;
      }
      void settleOnClose(io);
    };
    win.addEventListener("unload", onUnload, { once: true });
  });

  await handleDialogResult(io, sourceItem);
}

/** Point an already-open dialog at the latest source item via `reload`. */
async function retargetExistingWindow(
  win: Window,
  io: MultilingualItemDialogIO,
): Promise<void> {
  const reload = getDialogIO(win)?.reload;
  if (typeof reload !== "function") {
    // A window without the hook (e.g. left over from a plugin reload) cannot
    // be retargeted; fall back to plain focusing.
    io.superseded = true;
    io.deferred.resolve();
    win.focus();
    return;
  }
  await new Promise<void>((resolve) => {
    io.deferred.resolve = resolve;
    win.addEventListener("unload", () => void settleOnClose(io), {
      once: true,
    });
    // Focus first: `reload()` shows its discard prompt synchronously, which
    // would otherwise be left behind the main window.
    win.focus();
    if (!reload(io)) {
      io.superseded = true;
      resolve();
    }
  });
}

/** Read the window IO; Zotero passes it raw or wrapped as `arguments[0]`. */
function getDialogIO(win: Window): MultilingualItemDialogIO | null {
  return unwrapMultilingualDialogIO(win.arguments?.[0]);
}

async function handleDialogResult(
  io: MultilingualItemDialogIO,
  sourceItem: Zotero.Item,
): Promise<void> {
  if (io.superseded) return;
  if (io.result?.id) {
    await Zotero.getActiveZoteroPane()?.selectItem(io.result.id);
  }
  if (io.notice) {
    // The dialog is gone, so a notice cannot be shown in it any more; a
    // progress window does not block the main window the way an alert would.
    new ztoolkit.ProgressWindow(addon.data.config.addonName, {
      closeOnClick: true,
      closeTime: 8000,
    })
      .createLine({ text: io.notice, type: "default" })
      .show();
  }

  if (!io.result) {
    try {
      const storedItem = await Zotero.Items.getByLibraryAndKeyAsync(
        sourceItem.libraryID,
        sourceItem.key,
        { noCache: true },
      );
      if (sourceItem.deleted || storedItem === false) {
        ztoolkit.getGlobal("alert")(
          t("multilingual-item-error-source-deleted"),
        );
      }
    } catch (error) {
      ztoolkit.logError(error);
    }
  }
}
