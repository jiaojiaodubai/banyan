import { getPref } from "../utils/prefs";
import { hasItemMenuDeclarations, LAST_USED_STYLE_PREF } from "./styles";

/** Preference holding the style whose declarations feed the item menu. */
export const ITEM_MENU_STYLE_PREF = "itemMenuStyleId" as const;

/** Preference value that disables the item menu's declared entries. */
export const ITEM_MENU_DISABLED = "-";

/**
 * The style whose declarations feed the item menu: the explicit choice while
 * that style still declares something, otherwise the last style used for
 * rendering. `-` opts out entirely.
 */
export function getEffectiveItemMenuStyleId(): string {
  const explicit = String(getPref(ITEM_MENU_STYLE_PREF) ?? "");
  if (explicit === ITEM_MENU_DISABLED) {
    return "";
  }
  if (explicit && hasItemMenuDeclarations(explicit)) {
    return explicit;
  }
  return String(getPref(LAST_USED_STYLE_PREF) ?? "");
}

/**
 * Which entry of the preferences' style list to show for the stored value: the
 * value itself while it still has a candidate, otherwise "Last used". Display
 * only — the stored value is never rewritten here.
 */
export function getItemMenuSourceSelection(
  current: string,
  styleIds: readonly string[],
): string {
  if (current === "" || current === ITEM_MENU_DISABLED) {
    return current;
  }
  return styleIds.includes(current) ? current : "";
}
