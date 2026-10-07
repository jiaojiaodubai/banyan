import type { ItemContentSnapshot } from "./multilingualItem";

/**
 * Outcome of persisting a draft. A plain union, not a thrown error: the commit
 * result crosses realms, where `instanceof` on a plugin class would fail.
 */
export type MultilingualCommitResult =
  | { ok: true; item: Zotero.Item; notice?: string }
  | { ok: false; duplicateItem: Zotero.Item }
  | { ok: false; message: string };

/**
 * What the plugin-realm transaction reports before it is turned into a
 * `MultilingualCommitResult`; failures are thrown, not returned.
 */
export type MultilingualCommitOutcome =
  | { ok: true; item: Zotero.Item; notice?: string }
  | { ok: false; duplicateItem: Zotero.Item };

/**
 * Shared IO contract for the singleton dialog, passed through
 * `window.arguments[0]`: the opener publishes `commit`, the dialog publishes
 * `reload` and settles `deferred`, and both realms read the same object.
 */
export type MultilingualItemDialogIO = {
  sourceItem: Zotero.Item;
  result: Zotero.Item | null;
  superseded?: boolean;
  deferred: {
    resolve: () => void;
  };
  /** Installed by the dialog so the opener can retarget it in place. */
  reload?: (nextIO: MultilingualItemDialogIO) => boolean;
  /**
   * Set by the dialog before it closes when the commit has something to say
   * that should not keep the window open; the opener shows it afterwards.
   */
  notice?: string | null;
  /**
   * Installed by the opener so the dialog persists through the plugin realm.
   * The dialog must NOT import `commitMultilingualDraft` itself: the separate
   * bundle entry would be duplicated into the dialog realm. The snapshot is
   * what the session was built from, so the commit can tell whether the source
   * still holds it.
   */
  commit?: (
    source: Zotero.Item,
    draft: Zotero.Item,
    sourceContent: ItemContentSnapshot,
  ) => Promise<MultilingualCommitResult>;
  /**
   * Existing item with the same canonical language tag; re-checked on commit.
   */
  findDuplicate: (
    source: Zotero.Item,
    language: string,
  ) => Promise<Zotero.Item | null>;
  /** The in-flight commit, awaited before the opener settles `deferred`. */
  commitPending?: Promise<MultilingualCommitResult>;
};
