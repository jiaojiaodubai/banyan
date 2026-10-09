/** IO exchanged with the "Extend Creator Information" window. */
export type CreatorExtDialogIO = {
  itemID: number;
  focusCreatorIndex?: number;
  deferred: {
    resolve: () => void;
  };
};
