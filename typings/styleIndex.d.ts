/** Host-side shapes of the styles the plugin indexes (`addon.data.styles`). */
import type { FieldPreset, StyleInfo } from "./style";

/** Metadata shown for one style in the style manager and the server list. */
export type StyleSummary = Pick<
  StyleInfo,
  "id" | "title" | "citationType" | "description" | "updated"
>;

/** A style in the plugin's index, with the file it was read from. */
export type StyleFile = StyleSummary & {
  filename: string;
  /** Whether the style declares item-menu presets (executable declarations
   * live in the main-window bundle). */
  hasFieldPresets?: boolean;
  /** Item types with at least one declared field check. */
  itemFieldValidatorTypes?: string[];
};

/** A preset kept in the plugin index, tagged with its owning style. */
export type IndexedFieldPreset = FieldPreset & {
  /** `<styleId>:<presetId>` — stable identifier for logs and menu keys. */
  key: string;
  styleId: string;
  styleTitle: string;
};
