/** Host-side report shape shared by the validator runner and its dialog. */
export type FieldCheckStatus = "pass" | "fail" | "error";

export type FieldCheckErrorReason = "thrown" | "invalid-result" | "timeout";

/** One checker's outcome, ready to be rendered in the report window. */
export type FieldCheckEntry = {
  description: string;
  status: FieldCheckStatus;
  messages: string[];
  /** Set when `status` is `error`; the dialog localizes the reason. */
  error?: FieldCheckErrorReason;
};

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
