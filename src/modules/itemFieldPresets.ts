import {
  analyzeExtraField,
  mergeExtraField,
  needsConflictDecision,
} from "@banyan/core/items/extraField";
import {
  isValidExtraKey,
  normalizeExtraKey,
  toTitleCaseExtraKey,
} from "@banyan/core/items/extra";
import { toBanyanItem } from "./sandbox/items";
import { getLocaleID, useL10n } from "../utils/locale";
import { showSimpleMessage } from "../utils/message";
import { getRegularSelection } from "../utils/selection";
import {
  getItemPromptLabel,
  promptExtraConflict,
  promptExtraFieldValue,
  recoverItemAfterFailedSave,
  type ConflictAction,
} from "./extraFieldWrite";
import { getFieldPresetMenuLabel } from "@banyan/core/validation/fieldPresets";
import { getEffectiveItemMenuStyleId } from "./itemMenu";
import type { ItemMenuContribution, ItemMenuData } from "../../typings/menu";
import type { IndexedFieldPreset } from "../../typings/styleIndex";
import { createLogger } from "../utils/logger";

const log = createLogger("field-presets");

const t = useL10n(["mainWindow.ftl"]);

type PresetRoute =
  | { kind: "field"; fieldName: string }
  | { kind: "extra"; key: string; writeKey: string };

export const fieldPresetsItemMenu: ItemMenuContribution = {
  id: "field-presets",
  build() {
    const submenu = buildFieldPresetSubmenu();
    return submenu ? [submenu] : null;
  },
};

/**
 * The "Quick Marks" submenu, or null when the effective style declares none.
 * `onShowing` hides the presets that do not apply, since the selection only
 * exists once the popup opens.
 */
function buildFieldPresetSubmenu(): ItemMenuData | null {
  const presets = getFieldPresets();
  if (!presets.length) {
    return null;
  }
  return {
    menuType: "submenu",
    l10nID: getLocaleID("menuitem-field-presets"),
    onShowing: (_event, context) => {
      try {
        context.setVisible(presets.some(hasPresetTargets));
      } catch (error) {
        log.warn("判断字段预设是否有可用目标失败", error);
        context.setVisible(false);
      }
    },
    menus: presets.map(buildPresetMenuItem),
  };
}

/** One menu entry per preset; applicability follows the live selection. */
function buildPresetMenuItem(preset: IndexedFieldPreset): ItemMenuData {
  return {
    menuType: "menuitem",
    onShowing: (_event, context) => {
      try {
        context.menuElem.setAttribute("label", getFieldPresetMenuLabel(preset));
        context.setVisible(getPresetTargets(preset).length > 0);
      } catch (error) {
        log.warn("构建字段预设菜单项失败", error);
        context.setVisible(false);
      }
    },
    onCommand: () => {
      // The run reports its own failures; this only keeps an unexpected throw
      // from becoming an unhandled rejection.
      void applyFieldPresets(preset).catch((error: unknown) => {
        log.error("应用字段预设失败", error);
      });
    },
  };
}

/** Presets of the effective style; empty when none applies. */
function getFieldPresets(): IndexedFieldPreset[] {
  const styleId = getEffectiveItemMenuStyleId();
  if (!styleId) {
    return [];
  }
  return addon.data.styles.fieldPresets.get(styleId) ?? [];
}

/** Selected items a preset applies to (editable, and accepted by `visible`). */
function getPresetTargets(preset: IndexedFieldPreset): Zotero.Item[] {
  const { canEdit, items } = getRegularSelection();
  if (!canEdit) {
    return [];
  }
  return items.filter((item) => isPresetTarget(preset, item));
}

/** Whether the selection holds at least one item the preset applies to. */
function hasPresetTargets(preset: IndexedFieldPreset): boolean {
  const { canEdit, items } = getRegularSelection();
  if (!canEdit) {
    return false;
  }
  return items.some((item) => isPresetTarget(preset, item));
}

/** One item's verdict, with a throwing item excluded instead of aborting. */
function isPresetTarget(
  preset: IndexedFieldPreset,
  item: Zotero.Item,
): boolean {
  try {
    if (!item.isEditable()) {
      return false;
    }
    return !preset.visible || preset.visible(toBanyanItem(item)) === true;
  } catch (error) {
    log.warn("判断条目是否适用字段预设失败", error);
    return false;
  }
}

/** One decided write, ready to be applied to an item. */
type PresetWrite = { route: PresetRoute; value: string };

/** Outcome of planning one item: what to write, or that the user cancelled. */
type PresetPlan =
  { kind: "plan"; writes: PresetWrite[] } | { kind: "cancelled" };

/** What an item already holds for one route, in field order. */
function getPresetExistingValues(
  item: Zotero.Item,
  route: PresetRoute,
): string[] {
  if (route.kind === "field") {
    const current = String(item.getField(route.fieldName) ?? "").trim();
    return current ? [current] : [];
  }
  const extraText = String(item.getField("extra") || "");
  return analyzeExtraField(extraText, route.key).values;
}

/**
 * Decide what a preset writes onto one item: ask for the values the style left
 * to the user (`null`), confirm conflicting ones, and write nothing yet.
 */
async function planPresetWrites(
  preset: IndexedFieldPreset,
  item: Zotero.Item,
  session: { autoAction: Exclude<ConflictAction, "cancel"> | null },
): Promise<PresetPlan> {
  const writes: PresetWrite[] = [];

  for (const [key, declared] of Object.entries(preset.fields)) {
    const route = resolvePresetRoute(item, preset.id, key);
    if (!route) {
      continue;
    }

    let value = declared;
    if (value === null) {
      const asked = await askPresetValue(item, route);
      if (asked === null) {
        return { kind: "cancelled" };
      }
      value = asked;
    }

    const existing = getPresetExistingValues(item, route);
    if (existing.length === 1 && existing[0] === value) {
      // Already marked: neither a prompt nor a reordering of `extra`.
      continue;
    }
    if (needsConflictDecision(existing, value)) {
      const conflictKey = route.kind === "extra" ? route.writeKey : key;
      let action = session.autoAction;
      if (!action) {
        const decision = promptExtraConflict(
          item,
          conflictKey,
          existing,
          value,
        );
        if (decision.action === "cancel") {
          return { kind: "cancelled" };
        }
        if (decision.applyToRemaining) {
          session.autoAction = decision.action;
        }
        action = decision.action;
      }
      if (action === "skip") {
        continue;
      }
    }

    writes.push({ route, value });
  }

  return { kind: "plan", writes };
}

/** Outcome of applying one item's plan in memory. */
type PresetApplyResult = {
  /** Puts the item back to the state `applyPresetWrites()` found. */
  restore: () => void;
  /** Whether every write was accepted; `false` means the item must not be saved. */
  ok: boolean;
};

/** Read one field, or `null` when the item cannot be read (a stale item). */
function readField(item: Zotero.Item, fieldName: string): string | null {
  try {
    return String(item.getField(fieldName) ?? "");
  } catch (error) {
    log.warn("读取条目字段失败", error);
    return null;
  }
}

/**
 * Apply a plan to one item in memory, without throwing: a field accessor can
 * still refuse a value the style declared valid. `restore` puts back the values
 * read here, and `ok: false` tells the caller to drop the item.
 *
 * Every extra key of the preset goes through one merge of the field, so a preset
 * writing several keys touches `extra` once.
 */
function applyPresetWrites(
  item: Zotero.Item,
  writes: readonly PresetWrite[],
): PresetApplyResult {
  const noop = () => {
    /* nothing was applied */
  };
  const originalExtra = readField(item, "extra");
  if (originalExtra === null) {
    return { restore: noop, ok: false };
  }

  const touchedFields = new Map<string, string>();
  let extraText = originalExtra;
  let ok = true;

  const write = (run: () => void): void => {
    try {
      run();
    } catch (error) {
      log.error("写入条目字段失败", error);
      ok = false;
    }
  };

  for (const { route, value } of writes) {
    if (route.kind === "field") {
      if (!touchedFields.has(route.fieldName)) {
        const previous = readField(item, route.fieldName);
        if (previous === null) {
          ok = false;
          continue;
        }
        touchedFields.set(route.fieldName, previous);
      }
      write(() => item.setField(route.fieldName, value));
      continue;
    }
    write(() => {
      extraText = mergeExtraField(extraText, route.writeKey, route.key, value);
    });
  }

  const extraChanged = extraText !== originalExtra;
  if (extraChanged) {
    write(() => item.setField("extra", extraText));
  }

  return {
    restore: () => {
      for (const [fieldName, previous] of touchedFields) {
        try {
          item.setField(fieldName, previous);
        } catch (error) {
          log.warn("恢复字段原值失败", error);
        }
      }
      if (extraChanged) {
        try {
          item.setField("extra", originalExtra);
        } catch (error) {
          log.warn("恢复 extra 字段失败", error);
        }
      }
    },
    ok,
  };
}

/**
 * Write one preset's values onto the items it applies to. A value already equal
 * to the target is left alone, a different one asks for a decision (skippable,
 * with "apply to remaining"), a `null` value is asked for per item, and each
 * item is saved once. An item that cannot be written or saved is counted as
 * failed, and the remaining items are still processed.
 */
async function applyFieldPresets(preset: IndexedFieldPreset): Promise<void> {
  const targets = getPresetTargets(preset);
  if (!targets.length) {
    return;
  }

  const session: { autoAction: Exclude<ConflictAction, "cancel"> | null } = {
    autoAction: null,
  };
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let aborted = false;

  for (const item of targets) {
    let plan: PresetPlan;
    try {
      plan = await planPresetWrites(preset, item, session);
    } catch (error) {
      log.error("规划字段预设写入失败", error);
      failed++;
      continue;
    }

    if (plan.kind === "cancelled") {
      aborted = true;
      break;
    }
    if (!plan.writes.length) {
      skipped++;
      continue;
    }

    const applied = applyPresetWrites(item, plan.writes);
    if (!applied.ok) {
      await recoverItemAfterFailedSave(item, applied.restore);
      failed++;
      continue;
    }

    try {
      await item.saveTx();
      updated++;
    } catch (error) {
      log.error("保存条目失败", error);
      await recoverItemAfterFailedSave(item, applied.restore);
      failed++;
    }
  }

  showSimpleMessage(
    t("extra-field-write-summary", {
      args: {
        updated,
        skipped,
        failed,
        aborted: aborted ? 1 : 0,
      },
    }),
  );
}

/**
 * Ask the user for one preset value (declared as `null`), reusing the write
 * dialog with the key fixed and a hint naming the style. Cancelling aborts the
 * run.
 */
async function askPresetValue(
  item: Zotero.Item,
  route: PresetRoute,
): Promise<string | null> {
  const displayKey = route.kind === "field" ? route.fieldName : route.writeKey;
  return promptExtraFieldValue({
    key: displayKey,
    hint: t("field-preset-value-hint", {
      args: {
        key: displayKey,
        item: getItemPromptLabel(item),
      },
    }),
  });
}

/**
 * Where a preset key lands on one item: a real field when the name is valid
 * for that item type, otherwise an `extra` line. Decided per item, because the
 * same key can be a field for one type and an extra key for another.
 */
function resolvePresetRoute(
  item: Zotero.Item,
  presetId: string,
  key: string,
): PresetRoute | null {
  const fieldID = Zotero.ItemFields.getID(key);
  if (fieldID) {
    try {
      const typeFieldID =
        Zotero.ItemFields.getFieldIDFromTypeAndBase(item.itemTypeID, fieldID) ||
        fieldID;
      if (Zotero.ItemFields.isValidForType(typeFieldID, item.itemTypeID)) {
        const fieldName = Zotero.ItemFields.getName(typeFieldID);
        if (typeof fieldName === "string" && fieldName) {
          return { kind: "field", fieldName };
        }
      }
    } catch (error) {
      log.warn("解析字段预设键失败", error);
    }
  }
  if (!isValidExtraKey(key)) {
    // A key outside the variable-line charset would be written but never read
    // back, so every apply would append another line for it.
    log.warn(
      `preset '${presetId}': '${key}' cannot be written as an extra field key; ignored`,
    );
    return null;
  }
  return {
    kind: "extra",
    key: normalizeExtraKey(key),
    writeKey: toTitleCaseExtraKey(key),
  };
}
