/** IO exchanged with the shared item editor window. */
export type ItemEditorDialogIO = {
  itemID: number;
  initialField?: string;
  initialCreatorIndex?: number;
  deferred: {
    resolve: () => void;
  };
};
