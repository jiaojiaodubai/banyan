import { runItemFieldValidators } from "@banyan/core/validation/itemFieldValidators";
import type {
  FieldValidator,
  ItemFieldValidators,
} from "@banyan/core/types/style";
import { getLocaleID } from "../utils/locale";
import { getRegularSelection } from "../utils/selection";
import { getItemPromptLabel } from "./extraFieldWrite";
import { getEffectiveItemMenuStyleId } from "./itemMenu";
import { getStyleItemFieldValidators } from "./styles";
import { toBanyanItem } from "./sandbox/items";
import { isWindowAlive, openMainWindowDialog } from "../utils/window";
import type { ItemMenuContribution } from "../../typings/menu";
import type {
  ItemFieldCheckReport,
  ItemFieldValidatorDialogIO,
} from "../../typings/itemFieldValidator";
import type { IndexedItemFieldValidators } from "../../typings/styleIndex";
import { createLogger } from "../utils/logger";

const log = createLogger("item-field-validators");

const DIALOG_WINDOW_NAME = "banyan-item-field-validator";

let reportWindow: Window | null = null;

export const itemFieldValidatorsItemMenu: ItemMenuContribution = {
  id: "item-field-validators",
  build() {
    const indexed = getEffectiveValidators();
    if (!indexed) {
      return null;
    }
    return [
      {
        menuType: "menuitem",
        l10nID: getLocaleID("menuitem-check-item-fields"),
        onShowing: (_event, context) => {
          try {
            context.setVisible(getCheckTargets(indexed).length > 0);
          } catch (error) {
            log.warn("判断条目字段检查是否有可用目标失败", error);
            context.setVisible(false);
          }
        },
        onCommand: () => {
          // The run reports its own failures; this only keeps an unexpected
          // rejection from becoming an unhandled promise.
          void runChecksAndOpenReport().catch((error: unknown) => {
            log.error("检查字段失败", error);
          });
        },
      },
    ];
  },
};

/** The effective style's field-check declaration, if it has one. */
function getEffectiveValidators(): IndexedItemFieldValidators | null {
  const styleId = getEffectiveItemMenuStyleId();
  if (!styleId) {
    return null;
  }
  return getStyleItemFieldValidators(styleId) ?? null;
}

/** Editable selected items with at least one checker for their type. */
function getCheckTargets(indexed: IndexedItemFieldValidators): Zotero.Item[] {
  const { canEdit, items } = getRegularSelection();
  if (!canEdit) {
    return [];
  }
  return items.filter(
    (item) =>
      item.isEditable() &&
      getTypeValidators(indexed.byType, item.itemType).length > 0,
  );
}

async function runChecksAndOpenReport(): Promise<void> {
  const indexed = getEffectiveValidators();
  if (!indexed) {
    return;
  }

  const { canEdit, items } = getRegularSelection();
  if (!canEdit) {
    return;
  }

  const reports: ItemFieldCheckReport[] = [];
  for (const item of items) {
    if (!item.isEditable()) {
      continue;
    }
    reports.push(await buildItemReport(indexed.byType, item));
  }

  if (!reports.length) {
    return;
  }

  openReportWindow({ styleTitle: indexed.styleTitle, reports });
}

/**
 * Run one item's checks and capture everything the report needs. Items whose
 * type has no checker still get a report row, so a mixed selection shows which
 * item was not covered by the style.
 */
async function buildItemReport(
  byType: ItemFieldValidators,
  item: Zotero.Item,
): Promise<ItemFieldCheckReport> {
  const itemType = String(item.itemType);
  const validators = getTypeValidators(byType, itemType);
  const banyanItem = toBanyanItem(item);
  const checks = validators.length
    ? await runItemFieldValidators(validators, banyanItem)
    : [];

  return {
    itemId: String(item.id),
    title: getItemPromptLabel(item),
    itemType,
    itemTypeLabel: Zotero.ItemTypes.getLocalizedString(item.itemTypeID),
    firstCreator: String(banyanItem.firstCreator ?? ""),
    year: String(banyanItem.year ?? ""),
    checks,
  };
}

/**
 * Look one type up without asserting the string into `ItemType`: the index was
 * already normalized against the same schema, and an unknown type simply has no
 * checkers.
 */
function getTypeValidators(
  byType: ItemFieldValidators,
  itemType: string,
): readonly FieldValidator[] {
  for (const [type, validators] of Object.entries(byType)) {
    if (type === itemType) {
      return validators ?? [];
    }
  }
  return [];
}

/**
 * Show the report beside the library. The window is deliberately not modal:
 * the user is expected to fix entries while reading the results. A second run
 * replaces the previous report because stale results would be misleading.
 */
function openReportWindow(io: ItemFieldValidatorDialogIO): void {
  try {
    if (reportWindow && isWindowAlive(reportWindow)) {
      reportWindow.close();
    }
  } catch (error) {
    log.warn("关闭旧字段检查报告失败", error);
  }

  const win = openMainWindowDialog(
    `chrome://${addon.data.config.addonRef}/content/itemFieldValidatorDialog.xhtml`,
    "chrome,dialog=no,titlebar,resizable=yes,centerscreen,width=960,height=620",
    io,
    DIALOG_WINDOW_NAME,
  );
  reportWindow = win;
  win.addEventListener("unload", () => {
    if (reportWindow === win) {
      reportWindow = null;
    }
  });
}

/** Close the report window when the plugin shuts down. */
export function closeItemFieldValidatorWindow(): void {
  try {
    if (reportWindow && isWindowAlive(reportWindow)) {
      reportWindow.close();
    }
  } catch (error) {
    log.warn("关闭字段检查报告失败", error);
  }
  reportWindow = null;
}
