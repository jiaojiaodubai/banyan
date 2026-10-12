declare namespace Zotero {
  namespace DataObject {
    interface SaveOptions {
      /**
       * Fluent message ID for the undo entry's action label
       * (e.g. `undo-action-edit-creator`); without this the save is captured
       * but discarded at commit.
       */
      undoAction?: string;

      /** Fluent message arguments for the action label (e.g. `{ count: 3 }`). */
      undoActionArgs?: Record<string, unknown>;
    }
  }

  /** `Zotero.DataObject`, the base of `Zotero.Item`, `Zotero.Collection`, … . */
  interface DataObject {
    /**
     * Reload data from the database, discarding unsaved changes.
     *
     * @param dataTypes types to reload; defaults to the loaded ones
     * @param reloadUnchanged reload types without changes too
     */
    reload(
      dataTypes?: string[] | null,
      reloadUnchanged?: boolean,
    ): Promise<void>;
  }
}
