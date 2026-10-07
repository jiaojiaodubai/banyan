import { collectRelatableItems } from "./relations";
import { useL10n } from "../utils/locale";
import { reloadItemContent } from "../utils/multilingualDraft";
import {
  hasWriteMarker,
  isSameGroup,
  isSyncWrite,
  selectBlockedMembers,
  selectLostFieldIDs,
  selectMismatchedMembers,
  wasItemTypeChanged,
  type GroupMember,
} from "../utils/multilingualRetype";

/** A member to move to the new type, next to the item its data came from. */
type SplitMember = {
  item: Zotero.Item;
  info: GroupMember;
};

type RetypeGroup = {
  members: GroupMember[];
  split: SplitMember[];
};

const t = useL10n(["mainWindow.ftl"]);

/**
 * Save marker for the members this module moves itself: their own `modify`
 * events would otherwise start another group scan per member.
 */
const RETYPE_SAVE_MARKER = "banyanMultilingualRetype";
const retypeSaveOptions = { notifierData: { [RETYPE_SAVE_MARKER]: true } };

/** Whether an event came from a save this module made itself. */
function isOwnRetypeWrite(extraData: unknown, id: number | string): boolean {
  return hasWriteMarker(extraData, id, RETYPE_SAVE_MARKER);
}

let observerID: string | null = null;
// Prompts are serialized, in the order the changes happened.
let pending: Promise<void> = Promise.resolve();

/**
 * Keep a multilingual group on one item type: a retyped member is stranded
 * (copies link only while they share a type), and retyping is lossy, so the
 * group moves only after the user confirms.
 */
export function registerRetypeObserver(): void {
  if (observerID !== null) {
    return;
  }
  observerID = Zotero.Notifier.registerObserver(
    {
      notify: (event, type, ids, extraData) => {
        if (event !== "modify" || type !== "item") {
          return;
        }
        for (const id of ids) {
          // Sync writes report a change the user never made, and the members
          // this module moves itself would start a group scan each; only the
          // ids a sync or that save actually wrote carry the marker.
          if (isSyncWrite(extraData, id) || isOwnRetypeWrite(extraData, id)) {
            continue;
          }
          if (wasItemTypeChanged(extraData, id)) {
            enqueue(Number(id));
          }
        }
      },
    },
    ["item"],
    "banyan-multilingual-retype",
  );
}

export function unregisterRetypeObserver(): void {
  if (observerID !== null) {
    Zotero.Notifier.unregisterObserver(observerID);
    observerID = null;
  }
}

function enqueue(id: number): void {
  pending = pending
    .then(() => reportSplit(id))
    .catch((error: unknown) => {
      ztoolkit.logError(error);
      try {
        notify(t("multilingual-retype-read-error"));
      } catch (notifyError) {
        ztoolkit.logError(notifyError);
      }
    });
}

async function reportSplit(id: number): Promise<void> {
  const changed = await Zotero.Items.getAsync(id);
  if (!changed || !changed.isRegularItem() || changed.deleted) {
    return;
  }
  await changed.loadDataType("relations");
  await changed.loadDataType("itemData");

  const group = await collectRetypeGroup(changed, changed.itemTypeID);
  const split = group.split;
  if (!split.length) {
    return;
  }
  const newTypeName = Zotero.ItemTypes.getLocalizedString(changed.itemTypeID);
  const newTypeHasCreators = Zotero.CreatorTypes.itemTypeHasCreators(
    changed.itemTypeID,
  );
  // Point at the item first, so the prompt always has something to show.
  await focusItem(changed.id);

  // `setType()` refuses a type without creators taking over one that has some.
  const blocked = selectBlockedMembers(
    split.map(({ info }) => info),
    newTypeHasCreators,
  );
  if (blocked.length) {
    notify(
      t("multilingual-retype-blocked", {
        args: { type: newTypeName, count: blocked.length },
      }),
    );
    return;
  }

  const choice = Zotero.Prompt.confirm({
    window: Zotero.getMainWindow(),
    title: t("multilingual-retype-title"),
    text: [
      t("multilingual-retype-message", {
        args: {
          item: changed.getDisplayTitle(),
          type: newTypeName,
          count: split.length,
        },
      }),
      "",
      ...split.map(({ item }) => describeMember(item, changed.itemTypeID)),
      "",
      t("multilingual-retype-question", { args: { type: newTypeName } }),
    ].join("\n"),
    button0: t("multilingual-retype-confirm", { args: { type: newTypeName } }),
    button1: t("multilingual-retype-close"),
    defaultButton: 1,
  });
  if (choice !== 0) {
    return;
  }
  await applyRetype(changed.id, changed.itemTypeID, newTypeName, group.members);
}

/**
 * Move every member to the new type in one transaction, so the group is either
 * entirely on it or exactly as it was. The changed item stays outside, its save
 * already committed and impossible to roll back.
 */
async function applyRetype(
  changedID: number,
  newTypeID: number,
  newTypeName: string,
  confirmedGroup: GroupMember[],
): Promise<void> {
  // Modal only to its own window: the item may be retyped again meanwhile.
  const changed = await Zotero.Items.getAsync(changedID);
  if (!changed) {
    notify(t("multilingual-retype-stale"));
    return;
  }
  try {
    await reloadItemContent(changed);
  } catch (error) {
    ztoolkit.logError(error);
    notify(t("multilingual-retype-read-error"));
    return;
  }
  if (changed.deleted || changed.itemTypeID !== newTypeID) {
    notify(t("multilingual-retype-stale"));
    return;
  }
  // Re-read the group: the modal does not hold it; move only what was shown.
  const currentGroup = await collectRetypeGroup(changed, newTypeID);
  if (!isSameGroup(confirmedGroup, currentGroup.members)) {
    notify(t("multilingual-retype-stale"));
    return;
  }
  const current = currentGroup.split;
  const blocked = selectBlockedMembers(
    current.map(({ info }) => info),
    Zotero.CreatorTypes.itemTypeHasCreators(newTypeID),
  );
  if (blocked.length) {
    notify(
      t("multilingual-retype-blocked", {
        args: { type: newTypeName, count: blocked.length },
      }),
    );
    return;
  }
  try {
    await Zotero.DB.executeTransaction(async () => {
      for (const { item } of current) {
        if (item.itemTypeID === newTypeID) {
          continue;
        }
        item.setType(newTypeID);
        await item.save(retypeSaveOptions);
      }
    });
  } catch (error) {
    ztoolkit.logError(error);
    // The database rolled back, but the items keep the new type in memory, and
    // `reload()` refuses to change a type it considers loaded ("Cannot change
    // type in loadIn mode"). Restore the stored type first, then reload and
    // drop the change flags a rolled-back save leaves behind — what Zotero's
    // own `_recoverFromSaveError()` does, which cannot finish for these items.
    await Promise.all(
      current.map(async ({ item, info }) => {
        try {
          if (item.itemTypeID !== info.itemTypeID) {
            item.setType(info.itemTypeID);
          }
          await item.reload(["primaryData", "itemData", "creators"], true);
          item._clearChanged();
        } catch (reloadError) {
          ztoolkit.logError(reloadError);
        }
      }),
    );
    notify(
      t("multilingual-retype-error", {
        args: { item: changed.getDisplayTitle(), type: newTypeName },
      }),
    );
  }
}

/**
 * Collect a group snapshot and the members needing retyping; reads go through
 * the database so edits from another window (or sync) are not missed.
 */
async function collectRetypeGroup(
  changed: Zotero.Item,
  newTypeID: number,
): Promise<RetypeGroup> {
  const group = await collectRelatableItems([changed], {
    refreshRelations: true,
  });
  const items = new Map<number, Zotero.Item>();
  const infos: GroupMember[] = [];
  for (const item of group) {
    if (items.has(item.id)) {
      continue;
    }
    await reloadItemContent(item);
    items.set(item.id, item);
    infos.push({
      id: item.id,
      libraryID: item.libraryID,
      itemTypeID: item.itemTypeID,
      hasCreators: item.numCreators() > 0,
      deleted: item.deleted,
      content: snapshotRetypeContent(item),
    });
  }
  const split: SplitMember[] = [];
  for (const info of selectMismatchedMembers(
    {
      id: changed.id,
      libraryID: changed.libraryID,
      itemTypeID: newTypeID,
    },
    infos,
  )) {
    const item = items.get(info.id);
    if (item) {
      split.push({ item, info });
    }
  }
  return { members: infos, split };
}

function describeMember(item: Zotero.Item, newTypeID: number): string {
  const from = Zotero.ItemTypes.getLocalizedString(item.itemTypeID);
  const lost = selectLostFieldIDs(item, newTypeID).map((fieldID) =>
    Zotero.ItemFields.getLocalizedString(fieldID),
  );
  return lost.length
    ? t("multilingual-retype-line-lost", {
        args: {
          title: item.getDisplayTitle(),
          from,
          fields: lost.join(", "),
        },
      })
    : t("multilingual-retype-line", {
        args: { title: item.getDisplayTitle(), from },
      });
}

/** Include every item field for retype staleness, including abstractNote. */
function snapshotRetypeContent(item: Zotero.Item): string {
  const fields: Record<string, string> = {};
  for (const fieldID of Zotero.ItemFields.getItemTypeFields(item.itemTypeID)) {
    const field = Zotero.ItemFields.getName(fieldID);
    if (field) {
      fields[field] = item.getField(field);
    }
  }
  return JSON.stringify({ fields, creators: item.getCreators() });
}

async function focusItem(itemID: number): Promise<void> {
  try {
    await Zotero.getActiveZoteroPane()?.selectItem(itemID);
  } catch (error) {
    // Showing the split matters more than the selection failing here.
    ztoolkit.logError(error);
  }
}

function notify(text: string): void {
  Zotero.Prompt.confirm({
    window: Zotero.getMainWindow(),
    title: t("multilingual-retype-title"),
    text,
    button0: Zotero.Prompt.BUTTON_TITLE_OK,
  });
}
