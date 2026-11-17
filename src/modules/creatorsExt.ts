import { getLocaleID, useL10n } from "../utils/locale";
import { createLogger } from "../utils/logger";
import { getRegularSelection } from "../utils/selection";
import { unwrapCreatorExtDialogIO } from "../utils/creatorsExtDialogIO";
import {
  findWindowByName,
  isWindowAlive,
  openMainWindowDialog,
} from "../utils/window";
import type { CreatorExtDialogIO } from "../../typings/creatorsExtDialog";
import type { ItemMenuContribution } from "../../typings/menu";

const CREATOR_ROW_FIELD_PATTERN =
  /^creator-(\d+)-(?:lastName|firstName|typeID)$/;
const log = createLogger("creators-ext");

const t = useL10n(["mainWindow.ftl"]);

/** Matches the dialog root's `id`, so the window is findable while loading. */
function dialogWindowName(): string {
  return `${addon.data.config.addonRef}-creators-ext-dialog`;
}

/** Item the open dialog shows, or null when its IO cannot be read. */
function openDialogItemID(win: Window): number | null {
  return unwrapCreatorExtDialogIO(win.arguments?.[0])?.itemID ?? null;
}

/**
 * Open the creator editor, or focus the one already open. Modal plus a single
 * instance means the creator list cannot be edited underneath the editor.
 */
export function openCreatorsExtDialog(
  item: Zotero.Item,
  focusCreatorIndex?: number,
): Promise<void> {
  return new Promise((resolve) => {
    const io: CreatorExtDialogIO = {
      itemID: item.id,
      focusCreatorIndex,
      deferred: { resolve },
    };

    const existing = findWindowByName(dialogWindowName());
    if (existing && isWindowAlive(existing)) {
      if (openDialogItemID(existing) !== item.id) {
        notify(t("creators-ext-already-open"));
      }
      existing.focus();
      resolve();
      return;
    }

    const url = `chrome://${addon.data.config.addonRef}/content/creatorsExtDialog.xhtml`;
    // `dialog=no` is deliberately absent: it would drop the modality.
    openMainWindowDialog(
      url,
      "chrome,modal,centerscreen,resizable=yes",
      io,
      dialogWindowName(),
    );
  });
}

function notify(text: string, type: "default" | "error" = "default"): void {
  new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeTime: 4500,
  })
    .createLine({ text, type })
    .show();
}

/**
 * The item "Extend Creator Information" applies to, or null when the entry
 * does not. Zero-creator items are included on purpose: the window can add
 * creators from its empty state.
 */
function getCreatorsExtTarget(): Zotero.Item | null {
  const { canEdit, items, selectedCount } = getRegularSelection();
  if (
    !canEdit ||
    items.length !== 1 ||
    selectedCount !== 1 ||
    !items[0].isEditable()
  ) {
    return null;
  }
  return items[0];
}

export const creatorsExtItemMenu: ItemMenuContribution = {
  id: "creators-ext",
  build() {
    return [
      {
        menuType: "menuitem",
        l10nID: getLocaleID("menuitem-creators-ext"),
        // A hidden item cannot be activated, but both hooks resolve the
        // same target through one predicate so they cannot drift.
        onShowing: (_event, context) => {
          context.setVisible(getCreatorsExtTarget() !== null);
        },
        onCommand: () => {
          const item = getCreatorsExtTarget();
          if (!item) {
            return;
          }

          void openCreatorsExtDialog(item).catch((error) => {
            log.error("Failed to open the creator extension dialog", error);
            notify(
              t("creators-ext-open-failed", {
                args: {
                  message:
                    error instanceof Error ? error.message : String(error),
                },
              }),
              "error",
            );
          });
        },
      },
    ];
  },
};

/**
 * The creator row the menu applies to, or null when it does not. `onShowing`
 * and `onCommand` share it so they cannot drift.
 */
function getRowMenuTarget(
  context: _ZoteroTypes.MenuManager.ItemPaneMenuContext,
): { item: Zotero.Item; creatorIndex: number } | null {
  const item = context.items[0];
  const fieldMatch = CREATOR_ROW_FIELD_PATTERN.exec(context.fieldName ?? "");
  if (
    context.items.length !== 1 ||
    !context.editable ||
    !item?.isRegularItem() ||
    !item.isEditable() ||
    !fieldMatch
  ) {
    return null;
  }
  return { item, creatorIndex: Number(fieldMatch[1]) };
}

export function registerCreatorsExtRowMenu(): void {
  Zotero.MenuManager.registerMenu({
    menuID: `${addon.data.config.addonID}-creators-ext-row-menu`,
    pluginID: addon.data.config.addonID,
    target: "itemPane/info/row",
    menus: [
      {
        menuType: "menuitem",
        l10nID: getLocaleID("menuitem-creators-ext"),
        onShowing: (_event, context) => {
          context.setVisible(getRowMenuTarget(context) !== null);
        },
        onCommand: (_event, context) => {
          const target = getRowMenuTarget(context);
          if (!target) {
            return;
          }

          void openCreatorsExtDialog(target.item, target.creatorIndex).catch(
            (error) => {
              log.error("Failed to open the creator extension dialog", error);
              notify(
                t("creators-ext-open-failed", {
                  args: {
                    message:
                      error instanceof Error ? error.message : String(error),
                  },
                }),
                "error",
              );
            },
          );
        },
      },
    ],
  });
}
