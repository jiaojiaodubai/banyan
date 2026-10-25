import { createOutputItemMenu } from "./createOutput";
import { writeExtraFieldItemMenu } from "./extraFieldWrite";
import { createMultilingualItemItemMenu } from "./multilingualItem";
import { creatorsExtItemMenu, registerCreatorsExtRowMenu } from "./creatorsExt";
import { fieldPresetsItemMenu } from "./itemFieldPresets";
import { itemFieldValidatorsItemMenu } from "./itemFieldValidators";
import { relateItemsItemMenu } from "./relations";
import { openStyleEditorWindow } from "./styleEditor";
import { onStyleIndexChanged } from "./styles";
import { getLocaleID } from "../utils/locale";
import { getRegularSelection } from "../utils/selection";
import type { ItemMenuContribution, ItemMenuData } from "../../typings/menu";
import { config } from "../../package.json";
import { createLogger } from "../utils/logger";

const log = createLogger("menu");

// Menu items are localized through the Fluent DOM overlay, which REPLACES the
// element's children with a plain text node unless the message is defined as an
// attribute-only message (`.label = ...`). A plain-value message would wipe the
// rendered `.menu-icon` (no icon) and, for submenus, the nested <menupopup>
// (submenu can no longer open), and it drops the label out of `.menu-text`
// (2px shorter row). Every l10nID passed to `Zotero.MenuManager` below MUST
// resolve to a `.label` message in `addon/locale/*/mainWindow.ftl`.
// The vector logo is declared at the fixed 16x16 `.menu-icon` slot size and
// scaled by the consumers, so one SVG serves the menu, the manifest icons, and
// the in-window logos instead of a raster per size.
// Build the URL from the compile-time `config` instead of the `addon` global:
// module bodies run before `src/index.ts` assigns `_globalThis.addon`.
const MENU_ICON = `chrome://${config.addonRef}/content/icons/favicon.svg`;

const ITEM_MENU_ID = `${config.addonID}-item-menu`;

/**
 * Key returned by `Zotero.MenuManager.registerMenu` for the current item menu.
 * `_validate()` rejects a second registration with the same `menuID` instead of
 * replacing it, so the previous menu has to be dropped before re-registering.
 */
let itemMenuKey: string | false = false;

/**
 * The entries of the "Banyan" item submenu, in registration order. Every
 * feature owns its own entry (label, applicability, command); this module only
 * collects them and keeps the registration in sync.
 */
const ITEM_MENU_CONTRIBUTIONS: readonly ItemMenuContribution[] = [
  createOutputItemMenu,
  writeExtraFieldItemMenu,
  createMultilingualItemItemMenu,
  creatorsExtItemMenu,
  relateItemsItemMenu,
  fieldPresetsItemMenu,
  itemFieldValidatorsItemMenu,
];

/**
 * Whether the group has anything to offer for the current selection. Zotero
 * trims its own item actions outside editable views (the trash, publications,
 * read-only groups) by checking the collection row, which the view-level
 * `canEdit()` already reflects. Hiding only the entries would leave the group
 * in the menu as an empty submenu, so the group is hidden as a whole.
 */
function hasItemMenuEntries(): boolean {
  const { canEdit, items } = getRegularSelection();
  return canEdit && items.length > 0;
}

/** One failing contribution must not cost the whole menu. */
function buildContributedMenus(): ItemMenuData[] {
  const menus: ItemMenuData[] = [];
  for (const contribution of ITEM_MENU_CONTRIBUTIONS) {
    try {
      menus.push(...(contribution.build() ?? []));
    } catch (error) {
      log.error(
        `item menu contribution '${contribution.id}' could not be built`,
        error,
      );
    }
  }
  return menus;
}

/**
 * Register menu items in the Tools menu. Call once at startup: the native
 * `Zotero.MenuManager` keeps menus globally (keyed by `menuID`, removed on
 * shutdown through `pluginID`) and injects them into every main window.
 */
export function registerToolsMenu(): void {
  Zotero.MenuManager.registerMenu({
    menuID: `${config.addonID}-tools-menu`,
    pluginID: config.addonID,
    target: "main/menubar/tools",
    menus: [
      {
        menuType: "menuitem",
        l10nID: getLocaleID("menuitem-style-editor"),
        icon: MENU_ICON,
        onCommand: () => {
          openStyleEditorWindow();
        },
      },
    ],
  });
}

/**
 * (Re)register the item context menu, dropping the previous registration first.
 * Zotero injects the current menu the next time the popup opens, which is how
 * the "Quick Marks" entries follow the style index and the preferences.
 */
export function refreshItemMenu(): void {
  const contributedMenus = buildContributedMenus();
  if (itemMenuKey) {
    Zotero.MenuManager.unregisterMenu(itemMenuKey);
    itemMenuKey = false;
  }
  itemMenuKey = Zotero.MenuManager.registerMenu({
    menuID: ITEM_MENU_ID,
    pluginID: config.addonID,
    target: "main/library/item",
    menus: [
      {
        menuType: "submenu",
        l10nID: getLocaleID("addon-name"),
        icon: MENU_ICON,
        onShowing: (_event, context) => {
          context.setVisible(hasItemMenuEntries());
        },
        menus: contributedMenus,
      },
    ],
  });
}

/**
 * Register the item context menu and keep it in sync with the style index
 * (loading, import, save, delete) and with the preferences.
 */
export function registerContextMenu(): void {
  onStyleIndexChanged(refreshItemMenu);
  refreshItemMenu();
  registerCreatorsExtRowMenu();
}
