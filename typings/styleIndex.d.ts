/** Host-side shapes of the styles the plugin indexes (`addon.data.styles`). */
import type { ListRow, ParamPreset, StyleInfo } from "./style";

/**
 * Serializable view of one parameter declaration.
 *
 * Automation gets the declaration (id, label, description, kind, default,
 * states, presets, list fields and bounds), never a resolved `{ id: value }`
 * map. Runtime-only callbacks (`applicable`, `forcedValue`, `validate`) stay
 * in the style sandbox and are represented by `has*` flags.
 */
export type ParamInfo = {
  id: string;
  kind: "state" | "value" | "list";
  label: string;
  description?: string;
  defaultValue?: string | boolean | readonly ListRow[];
  states?: Record<string, string>;
  presets?: readonly ParamPreset[];
  format?: "plain" | "rich";
  fields?: ParamInfo[];
  /** Editor bounds of a list parameter (the core never enforces them). */
  min?: number;
  max?: number;
  hasApplicable?: true;
  hasForcedValue?: true;
  hasValidate?: true;
};

/** Metadata shown for one style in the style manager and the server list. */
export type StyleSummary = Pick<
  StyleInfo,
  "id" | "title" | "citationType" | "description" | "updated"
>;

/**
 * A style in the plugin's index, with the file it was read from.
 *
 * Everything reachable from this record must stay serializable: it is shared by
 * every window bundle, while the executable style instances (and the closures
 * they produce) belong to one window. The style's item-menu declarations are
 * therefore represented by their serializable presence only; the executable
 * presets/validators live in the main-window bundle, which rebuilds the index
 * and serves dialogs through `addon.api`.
 */
export type StyleFile = StyleSummary & {
  filename: string;
  /** Serializable style parameter declarations, captured on index. */
  optionParams?: ParamInfo[];
  /** Whether the style declares item-context-menu presets. */
  hasFieldPresets?: boolean;
  /** Item types with at least one declared field check. */
  itemFieldValidatorTypes?: string[];
};
