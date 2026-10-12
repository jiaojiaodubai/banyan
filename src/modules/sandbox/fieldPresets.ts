import type { FieldPreset, FieldPresetVisible } from "../../../typings/style";
import type { SandboxCu, SandboxGlobal } from "../sandboxUtils";
import { isValidExtraKey, normalizeExtraKey } from "../../utils/item";
import { createLogger } from "../../utils/logger";

const log = createLogger("field-presets");

/**
 * Primary (non-itemData) keys a preset must never target: writing them either
 * throws in `Zotero.Item.setField()` or changes item identity. The style
 * editor's lint rule keeps a copy of this list, and `tests-node/styleLint.test.ts`
 * asserts the two stay in step.
 */
export const DENIED_KEYS: ReadonlySet<string> = new Set([
  "extra",
  "id",
  "key",
  "itemType",
  "itemTypeID",
  "libraryID",
  "version",
  "dateAdded",
  "dateModified",
  "synced",
  "createdByUserID",
  "lastModifiedByUserID",
  "collections",
  "relations",
  "tags",
  "notes",
  "creators",
  "parentItem",
  "deleted",
]);

/** The same set in `normalizeExtraKey` form, so `Extra` / `extra` / `extra ` all match. */
const DENIED_NORMALIZED_KEYS: ReadonlySet<string> = new Set(
  Array.from(DENIED_KEYS, (key) => normalizeExtraKey(key)),
);

/**
 * CSL name variables (CSL 1.0.2, appendix IV): a preset writes a single value,
 * so citeproc never turns one into creators. Copied by the style editor's lint
 * rule, kept in step by `tests-node/styleLint.test.ts`.
 */
export const CSL_NAME_VARIABLES: ReadonlySet<string> = new Set([
  "author",
  "chair",
  "collection-editor",
  "compiler",
  "composer",
  "container-author",
  "contributor",
  "curator",
  "director",
  "editor",
  "editorial-director",
  "executive-producer",
  "guest",
  "host",
  "illustrator",
  "interviewer",
  "narrator",
  "organizer",
  "original-author",
  "performer",
  "presenter",
  "producer",
  "recipient",
  "reviewed-author",
  "script-writer",
  "series-creator",
  "translator",
]);

/**
 * Normalize the `ITEM_FIELD_PRESETS` export to host-side presets, as
 * `normalizeComponents()` does: waive the value out of the sandbox, validate entry
 * by entry, and drop what is unusable with a log line.
 */
export function normalizeFieldPresets(
  raw: unknown,
  host: Record<string, unknown>,
  sandbox: SandboxGlobal,
  Cu: SandboxCu,
): FieldPreset[] | undefined {
  let cmp: unknown;
  try {
    cmp = Cu.waiveXrays ? Cu.waiveXrays(raw) : raw;
  } catch {
    cmp = raw;
  }

  // Accept an array or an object map, like the citation controls do.
  let arr: unknown[] | undefined;
  if (Array.isArray(cmp)) arr = cmp;
  else if (cmp && typeof cmp === "object") {
    arr = Object.values(cmp as Record<string, unknown>);
  }
  if (!arr || !arr.length) return undefined;

  const seen = new Set<string>();
  const out: FieldPreset[] = [];

  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;

    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id) {
      log.warn("skipped entry without a non-empty string id");
      continue;
    }
    if (seen.has(id)) {
      log.warn(`skipped duplicate preset id '${id}'`);
      continue;
    }

    const fields = normalizeFields(record.fields, id);
    if (!fields) {
      log.warn(`skipped preset '${id}': no usable fields`);
      continue;
    }

    const cloned: Partial<FieldPreset> = {
      id,
      label: normalizeLabel(record.label, id),
      fields,
    };
    let hostPreset: FieldPreset;
    try {
      hostPreset = Cu.cloneInto
        ? (Cu.cloneInto(cloned, host) as FieldPreset)
        : (cloned as FieldPreset);
    } catch {
      hostPreset = cloned as FieldPreset;
    }
    if (typeof record.visible === "function") {
      hostPreset.visible = createVisibleEvaluator(record.visible, sandbox, Cu);
    }

    seen.add(id);
    out.push(hostPreset);
  }

  return out.length ? out : undefined;
}

/** Keep writable `key: "value"` pairs plus `key: null` (value to be filled at
 * apply time); returns undefined when nothing survives. */
function normalizeFields(
  raw: unknown,
  presetId: string,
): Record<string, string | null> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const out: Record<string, string | null> = {};
  for (const [rawKey, rawValue] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    const key = rawKey.trim();
    if (!key) continue;

    if (isDeniedKey(key)) {
      log.warn(
        `preset '${presetId}': '${key}' is not writable by a preset; ignored`,
      );
      continue;
    }

    if (!isValidExtraKey(key)) {
      log.warn(
        `preset '${presetId}': '${key}' is not a valid field key; ignored`,
      );
      continue;
    }

    if (rawValue === null) {
      out[key] = null;
      continue;
    }

    if (typeof rawValue !== "string") {
      log.warn(
        `preset '${presetId}': '${key}' must be a string or null; ignored`,
      );
      continue;
    }
    const value = rawValue.trim();
    if (!value) {
      log.warn(
        `preset '${presetId}': refusing to write an empty value to '${key}'`,
      );
      continue;
    }

    warnAdvisoryKey(presetId, key, value);
    out[key] = value;
  }

  return Object.keys(out).length ? out : undefined;
}

function isDeniedKey(key: string): boolean {
  return DENIED_NORMALIZED_KEYS.has(normalizeExtraKey(key));
}

/**
 * Advisory diagnostics only: a name variable cannot hold a preset's single value,
 * and `type: <Zotero item type>` re-classifies the item.
 */
function warnAdvisoryKey(presetId: string, key: string, value: string): void {
  try {
    if (CSL_NAME_VARIABLES.has(normalizeExtraKey(key))) {
      log.warn(
        `preset '${presetId}': '${key}' is a CSL name variable; a preset writes a single value, so creators are not applied`,
      );
    } else if (Zotero.CreatorTypes.getID(key)) {
      log.warn(
        `preset '${presetId}': '${key}' is a name variable; extra values for creators are not applied by citeproc`,
      );
    }
  } catch {
    /* host API unavailable */
  }

  try {
    if (normalizeExtraKey(key) === "type" && Zotero.ItemTypes.getID(value)) {
      log.warn(
        `preset '${presetId}': 'type: ${value}' is a Zotero item type name and will re-classify the item`,
      );
    }
  } catch {
    /* host API unavailable */
  }
}

function normalizeLabel(raw: unknown, fallback: string): string {
  if (typeof raw === "string") {
    const text = raw.trim();
    if (text) return text;
  } else if (raw !== undefined && raw !== null) {
    log.warn(`'${fallback}': label must be a string; using the preset id`);
  }
  return fallback;
}

/** Whether applying the preset still needs a value from the user. */
export function hasDeferredFieldValues(preset: FieldPreset): boolean {
  return Object.values(preset.fields).some((value) => value === null);
}

/**
 * Menu text of a preset: its label, plus an ellipsis when a value is to be filled
 * at apply time.
 */
export function getFieldPresetMenuLabel(preset: FieldPreset): string {
  const label = preset.label || preset.id;
  return hasDeferredFieldValues(preset) ? `${label}…` : label;
}

/**
 * Same bridging contract as the `UI.cite` predicates: the view is
 * cloned into the sandbox, and only a strict `true` counts as visible.
 */
function createVisibleEvaluator(
  raw: Function,
  sandbox: SandboxGlobal,
  Cu: SandboxCu,
): FieldPresetVisible {
  return (item) => {
    try {
      const sandboxItem = Cu.cloneInto(item, sandbox, {
        cloneFunctions: false,
      });
      return raw(sandboxItem) === true;
    } catch (error) {
      log.warn("Failed to evaluate the preset visibility predicate", error);
      return false;
    }
  };
}
