import type { Style } from "../../typings/style";
import { registerStyleIndexHooks } from "./styles";

/**
 * Executable style declarations, owned by the main-window bundle.
 *
 * `styles.ts` is bundled into every window. Its shared file index lives in
 * `addon.data.styles`; the closures a style instance produces for the item menu
 * (`visible`, `check`) live here instead. This module is imported only by the
 * main window's startup/menu modules, so those closures are created and invoked
 * in the main window. Dialogs ask `addon.api` to rebuild the index or run field
 * checks and never import this module.
 */

/** The item-menu declarations a style may expose; structural until the style
 * contract gains the dedicated author types later in the history. */
type ItemMenuStyle = Style & {
  ITEM_FIELD_PRESETS?: readonly {
    id: string;
    label: string;
    fields: Record<string, string | null>;
    visible?: (item: unknown) => boolean;
  }[];
  ITEM_FIELD_VALIDATORS?: Record<
    string,
    readonly {
      description: string;
      check: (item: unknown) => unknown;
    }[]
  >;
};

/** A preset declaration carrying its owning style's metadata. */
export type IndexedFieldPreset = NonNullable<
  ItemMenuStyle["ITEM_FIELD_PRESETS"]
>[number] & {
  key: string;
  styleId: string;
  styleTitle: string;
};

/** One style's executable field-check declarations. */
export type IndexedItemFieldValidators = {
  styleId: string;
  styleTitle: string;
  byType: NonNullable<ItemMenuStyle["ITEM_FIELD_VALIDATORS"]>;
};

/** Serializable summary of one style's item-menu declarations. */
export type StyleDeclarationSummary = {
  hasFieldPresets: boolean;
  itemFieldValidatorTypes: string[];
};

const indexedFieldPresets = new Map<string, IndexedFieldPreset[]>();
const indexedItemFieldValidators = new Map<
  string,
  IndexedItemFieldValidators
>();

function loadStyleDeclarations(style: Style): StyleDeclarationSummary {
  const styleId = style.INFO.id;
  const styleTitle = style.INFO.title || styleId;
  const menuStyle = style as ItemMenuStyle;

  const presets = menuStyle.ITEM_FIELD_PRESETS;
  if (presets?.length) {
    indexedFieldPresets.set(
      styleId,
      presets.map((preset) => ({
        ...preset,
        key: `${styleId}:${preset.id}`,
        styleId,
        styleTitle,
      })),
    );
  } else {
    indexedFieldPresets.delete(styleId);
  }

  const byType = menuStyle.ITEM_FIELD_VALIDATORS;
  const itemTypes = Object.keys(byType ?? {});
  if (itemTypes.length) {
    indexedItemFieldValidators.set(styleId, {
      styleId,
      styleTitle,
      byType: byType!,
    });
  } else {
    indexedItemFieldValidators.delete(styleId);
  }

  return {
    hasFieldPresets: Boolean(presets?.length),
    itemFieldValidatorTypes: itemTypes,
  };
}

function removeStyleDeclarations(styleId: string): void {
  indexedFieldPresets.delete(styleId);
  indexedItemFieldValidators.delete(styleId);
}

function clearStyleDeclarations(): void {
  indexedFieldPresets.clear();
  indexedItemFieldValidators.clear();
}

/** Executable presets of one indexed style (main window only). */
export function getIndexedFieldPresets(
  styleId: string,
): readonly IndexedFieldPreset[] {
  return indexedFieldPresets.get(styleId) ?? [];
}

/** Executable field-check declarations of one indexed style (main window only). */
export function getStyleItemFieldValidators(
  styleId: string,
): IndexedItemFieldValidators | undefined {
  return indexedItemFieldValidators.get(styleId);
}

registerStyleIndexHooks({
  load: loadStyleDeclarations,
  remove: removeStyleDeclarations,
  clear: clearStyleDeclarations,
});
