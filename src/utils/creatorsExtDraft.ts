import {
  CREATOR_EXT_FIELDS,
  CREATORS_EXT_KEY,
  creatorMatchesExtIdentity,
  parseCreatorsExt,
  parseExtraLines,
  reconcileCreatorsExt,
} from "./item";
import type {
  Creator,
  CreatorExtField,
  CreatorExtFields,
  CreatorExtRecord,
} from "../../typings/item";
import type { CreatorSnapshot } from "../../typings/multilingualItem";

/** One creator row as edited in the "Extend Creator Information" window. */
export type CreatorsExtDraft = {
  creatorType: _ZoteroTypes.Item.CreatorJSON["creatorType"];
  fieldMode: 0 | 1;
  firstName: string;
  lastName: string;
} & Record<CreatorExtField, string>;

/** Extension values a draft carries, trimmed and with the empty ones dropped. */
function draftExtensions(draft: CreatorsExtDraft): CreatorExtFields {
  const fields: CreatorExtFields = {};
  for (const field of CREATOR_EXT_FIELDS) {
    const value = draft[field].trim();
    if (value) {
      fields[field] = value;
    }
  }
  return fields;
}

export type CreatorsExtWrite = {
  /** Creator list for `setCreators()`, in final row order. */
  creators: _ZoteroTypes.Item.CreatorJSON[];
  /** `creators-ext` lines for `extra`, in final row order. */
  lines: string[];
};

export type CreatorsExtLoad = {
  /** Extension fields per creator index, for prefilling the window. */
  bindings: Map<number, CreatorExtFields>;
  /** Why a line was skipped; parsing and matching problems alike. */
  issues: string[];
  /** Raw lines that bind to nothing; saving drops them (`buildCreatorsExtWrite`). */
  orphanLines: string[];
};

/** What the window starts from: bindings, unmatched lines, and what went wrong. */
export function loadCreatorsExt(
  extraText: string,
  creators: readonly Creator[],
): CreatorsExtLoad {
  const lines = parseExtraLines(extraText).filter(
    (line) => line.normalizedKey === CREATORS_EXT_KEY,
  );
  const parsed = parseCreatorsExt({
    [CREATORS_EXT_KEY]: lines.map((line) => line.value),
  });
  const reconciled = reconcileCreatorsExt(parsed.records, creators);

  const orphanIndexes = new Set([
    ...parsed.issues.map(({ lineIndex }) => lineIndex),
    ...reconciled.unmatchedRecordLineIndexes,
  ]);

  return {
    bindings: reconciled.bindings,
    issues: [
      ...parsed.issues.map(
        ({ lineIndex, message }) => `Record ${lineIndex + 1}: ${message}`,
      ),
      ...reconciled.issues,
    ],
    orphanLines: lines
      .filter((_line, index) => orphanIndexes.has(index))
      .map((line) => line.value),
  };
}

/** Identity a draft claims, in the record shape the shared matcher expects. */
function draftIdentity(draft: CreatorsExtDraft): CreatorExtRecord {
  const lastName = draft.lastName.trim();
  if (draft.fieldMode === 1) {
    return { creatorType: draft.creatorType, fieldMode: 1, name: lastName };
  }
  return {
    creatorType: draft.creatorType,
    fieldMode: 0,
    firstName: draft.firstName.trim(),
    lastName,
  };
}

/**
 * Move the extension values on screen onto a freshly loaded creator list. A
 * matched draft wins even when its fields are empty (the user cleared them).
 */
export function carryOverCreatorExtensions(
  drafts: readonly CreatorsExtDraft[],
  creators: readonly Creator[],
): Map<number, CreatorExtFields> {
  const carried = new Map<number, CreatorExtFields>();
  const claimed = new Set<number>();

  for (const draft of drafts) {
    const index = creators.findIndex(
      (creator, position) =>
        !claimed.has(position) &&
        creatorMatchesExtIdentity(creator, draftIdentity(draft)),
    );
    if (index < 0) {
      continue;
    }
    claimed.add(index);
    carried.set(index, draftExtensions(draft));
  }

  return carried;
}

/**
 * What the window writes on save: the creator list plus rebuilt records for
 * rows that carry an extension. Rows with both names empty are dropped (as
 * itemBox does on blur), and lines that bind to no creator go with them.
 */
export function buildCreatorsExtWrite(
  drafts: readonly CreatorsExtDraft[],
): CreatorsExtWrite {
  const creators: _ZoteroTypes.Item.CreatorJSON[] = [];
  const lines: string[] = [];

  for (const draft of drafts) {
    const lastName = draft.lastName.trim();
    const firstName = draft.fieldMode === 1 ? "" : draft.firstName.trim();
    if (!lastName && !firstName) {
      continue;
    }

    creators.push(
      draft.fieldMode === 1
        ? { creatorType: draft.creatorType, name: lastName }
        : { creatorType: draft.creatorType, firstName, lastName },
    );

    const extensions = draftExtensions(draft);
    if (!Object.keys(extensions).length) {
      continue;
    }

    const record: CreatorExtRecord = {
      ...draftIdentity(draft),
      index: creators.length - 1,
    };
    lines.push(
      `${CREATORS_EXT_KEY}: ${JSON.stringify({ ...record, ...extensions })}`,
    );
  }

  return { creators, lines };
}

/** Whether the stored creator list differs from the one the window opened with. */
export function hasCreatorListChanged(
  before: readonly CreatorSnapshot[],
  after: readonly CreatorSnapshot[],
): boolean {
  if (before.length !== after.length) {
    return true;
  }
  return before.some((creator, index) => {
    const current = after[index];
    return (
      creator.creatorTypeID !== current.creatorTypeID ||
      creator.fieldMode !== current.fieldMode ||
      creator.firstName !== current.firstName ||
      creator.lastName !== current.lastName
    );
  });
}
