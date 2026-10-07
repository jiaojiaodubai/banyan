/**
 * Types shared across the multilingual-item modules: the draft builder
 * (`src/utils/multilingualDraft.ts`), the commit, the dialog and the
 * group-retype prompt all compare the same item content snapshots.
 */

/** One creator as stored, compared to detect edits made elsewhere. */
export type CreatorSnapshot = {
  creatorTypeID: number;
  fieldMode: number;
  firstName: string;
  lastName: string;
};

/** Copyable content of one item, compared to detect edits made elsewhere. */
export type ItemContentSnapshot = {
  libraryID: number | null;
  itemTypeID: number;
  fields: Record<string, string>;
  creators: CreatorSnapshot[];
};
