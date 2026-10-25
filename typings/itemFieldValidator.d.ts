import type { FieldCheckEntry } from "@banyan/core/validation/itemFieldValidators";

/** One item's field-check result, as the report window receives it. */
export type ItemFieldCheckReport = {
  itemId: string;
  title: string;
  itemType: string;
  itemTypeLabel: string;
  firstCreator?: string;
  year?: string;
  checks: FieldCheckEntry[];
};

/** Data passed to the non-modal field-check report window. */
export type ItemFieldValidatorDialogIO = {
  styleTitle: string;
  reports: ItemFieldCheckReport[];
};
