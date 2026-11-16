import type {
  FieldPreset,
  ItemFieldValidators,
  Style,
} from "@banyan/core/types/style";
import { registerStyleIndexHooks } from "./styles";

/**
 * Executable style declarations, owned by one window bundle.
 *
 * `styles.ts` is bundled into every window and its serializable index lives in
 * `addon.data.styles`. The closures produced by a style instance (`visible`,
 * `check`) stay here instead: this module is imported only by the main window's
 * startup/menu modules, so the maps are created in the main window and are
 * populated by the index reload that runs there. Dialogs request a reload or a
 * field check through `addon.api` and never import this module.
 */

/** A preset declaration carrying its owning style's metadata. */
export type IndexedFieldPreset = FieldPreset & {
  /** `<styleId>:<presetId>` — stable identifier for logs and menu keys. */
  key: string;
  styleId: string;
  styleTitle: string;
};

/** One style's executable field-check declarations. */
export type IndexedItemFieldValidators = {
  styleId: string;
  styleTitle: string;
  byType: ItemFieldValidators;
};

const indexedFieldPresets = new Map<string, IndexedFieldPreset[]>();
const indexedItemFieldValidators = new Map<
  string,
  IndexedItemFieldValidators
>();

/** Serializable summary of one style's item-menu declarations. */
export type StyleDeclarationSummary = {
  hasFieldPresets: boolean;
  itemFieldValidatorTypes: string[];
};

function loadStyleDeclarations(style: Style): StyleDeclarationSummary {
  const styleId = style.INFO.id;
  const styleTitle = style.INFO.title || styleId;

  const presets = style.ITEM_FIELD_PRESETS;
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

  const byType = style.ITEM_FIELD_VALIDATORS;
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

// `styles.ts` is bundled into dialogs too; installing the hooks here means only
// the bundles that import this module (the main window) can create executable
// declarations, while the shared index keeps just the serializable summary.
registerStyleIndexHooks({
  load: loadStyleDeclarations,
  remove: removeStyleDeclarations,
  clear: clearStyleDeclarations,
});
