import { getLocaleID, useL10n } from "../utils/locale";
import { getRegularSelection } from "../utils/selection";
import {
  findWindowByName,
  isWindowAlive,
  openMainWindowDialog,
} from "../utils/window";
import { unwrapDialogIO } from "../utils/window";
import { isRichTextField } from "../utils/richTextFieldScope";
import type { ItemEditorDialogIO } from "../../typings/itemEditorDialog";
import type { ItemMenuContribution } from "../../typings/menu";
import { createLogger } from "../utils/logger";

const log = createLogger("item-editor-window");
const t = useL10n(["mainWindow.ftl"]);
const WINDOW_NAME = "banyan-item-editor";
const CREATOR_ROW_FIELD_PATTERN =
  /^creator-(\d+)-(?:lastName|firstName|typeID)$/;

/**
 * Initial editor width: Zotero's default item-pane width plus room for the
 * three extension columns and the toolbar. The dialog measures the real
 * controls after rendering and installs the fixed content minimum.
 */
function initialEditorWidth(): number {
  return 480;
}

function notify(text: string, type: "default" | "error" = "default"): void {
  new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeTime: 4500,
  })
    .createLine({ text, type })
    .show();
}

function existingItemID(existing: Window): number | null {
  return (
    unwrapDialogIO<ItemEditorDialogIO>(existing.arguments?.[0])?.itemID ?? null
  );
}

type OpenOptions = {
  initialField?: string;
  initialCreatorIndex?: number;
};

/** Open the single item editor, or focus the one already open. */
export function openItemEditor(
  item: Zotero.Item,
  options: OpenOptions = {},
): Promise<void> {
  return new Promise((resolve) => {
    const existing = findWindowByName(WINDOW_NAME);
    if (existing && isWindowAlive(existing)) {
      if (existingItemID(existing) !== item.id) {
        notify(t("item-editor-already-open"));
      }
      existing.focus();
      const editor = existing.document?.getElementById("item-editor") as
        | (HTMLElement & {
            focusField?: (name: string) => void;
            focusCreator?: (index: number) => void;
          })
        | null;
      if (options.initialField) editor?.focusField?.(options.initialField);
      if (options.initialCreatorIndex !== undefined) {
        editor?.focusCreator?.(options.initialCreatorIndex);
      }
      resolve();
      return;
    }

    const io: ItemEditorDialogIO = {
      itemID: item.id,
      initialField: options.initialField,
      initialCreatorIndex: options.initialCreatorIndex,
      deferred: { resolve },
    };
    openMainWindowDialog(
      `chrome://${addon.data.config.addonRef}/content/itemEditorDialog.xhtml`,
      `chrome,modal,centerscreen,resizable=yes,width=${initialEditorWidth()},height=760`,
      io,
      WINDOW_NAME,
    );
  });
}

function getItemMenuTarget(): Zotero.Item | null {
  const { canEdit, items, selectedCount } = getRegularSelection();
  if (!canEdit || items.length !== 1 || selectedCount !== 1) return null;
  return items[0].isEditable() && items[0].isRegularItem() ? items[0] : null;
}

export const itemEditorItemMenu: ItemMenuContribution = {
  id: "item-editor",
  build() {
    return [
      {
        menuType: "menuitem",
        l10nID: getLocaleID("menuitem-edit-item"),
        onShowing: (_event, context) => {
          context.setVisible(getItemMenuTarget() !== null);
        },
        onCommand: () => {
          const item = getItemMenuTarget();
          if (!item) return;
          void openItemEditor(item).catch((error) => {
            log.error("Failed to open item editor", error);
            notify(t("item-editor-open-failed"), "error");
          });
        },
      },
    ];
  },
};

function getCreatorRowTarget(
  context: _ZoteroTypes.MenuManager.ItemPaneMenuContext,
): { item: Zotero.Item; creatorIndex: number } | null {
  const item = context.items[0];
  const match = CREATOR_ROW_FIELD_PATTERN.exec(context.fieldName ?? "");
  if (
    context.items.length !== 1 ||
    !context.editable ||
    !item?.isRegularItem() ||
    !item.isEditable() ||
    !match
  ) {
    return null;
  }
  return { item, creatorIndex: Number(match[1]) };
}

function getFieldRowTarget(
  context: _ZoteroTypes.MenuManager.ItemPaneMenuContext,
): { item: Zotero.Item; fieldName: string } | null {
  const item = context.items[0];
  if (
    context.items.length !== 1 ||
    !context.editable ||
    !item?.isRegularItem() ||
    !item.isEditable() ||
    !context.fieldName ||
    !isRichTextField(item, context.fieldName)
  ) {
    return null;
  }
  return { item, fieldName: context.fieldName };
}

export function registerItemEditorRowMenus(): void {
  Zotero.MenuManager.registerMenu({
    menuID: `${addon.data.config.addonID}-item-editor-row-menu`,
    pluginID: addon.data.config.addonID,
    target: "itemPane/info/row",
    menus: [
      {
        menuType: "menuitem",
        l10nID: getLocaleID("menuitem-creators-ext"),
        onShowing: (_event, context) => {
          context.setVisible(getCreatorRowTarget(context) !== null);
        },
        onCommand: (_event, context) => {
          const target = getCreatorRowTarget(context);
          if (!target) return;
          void openItemEditor(target.item, {
            initialCreatorIndex: target.creatorIndex,
          }).catch((error) => {
            log.error("Failed to open item editor on creator row", error);
            notify(t("item-editor-open-failed"), "error");
          });
        },
      },
      {
        menuType: "menuitem",
        l10nID: getLocaleID("menuitem-mark-field-format"),
        onShowing: (_event, context) => {
          context.setVisible(getFieldRowTarget(context) !== null);
        },
        onCommand: (_event, context) => {
          const target = getFieldRowTarget(context);
          if (!target) return;
          void openItemEditor(target.item, {
            initialField: target.fieldName,
          }).catch((error) => {
            log.error("Failed to open item editor on field row", error);
            notify(t("item-editor-open-failed"), "error");
          });
        },
      },
    ],
  });
}
