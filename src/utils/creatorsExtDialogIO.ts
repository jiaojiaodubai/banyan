import { unwrapDialogIO } from "./window";
import type { CreatorExtDialogIO } from "../../typings/creatorsExtDialog";

/** Guard for the IO this window reads, and the opener keeps. */
export function isCreatorExtDialogIO(
  value: unknown,
): value is CreatorExtDialogIO {
  return (
    typeof value === "object" &&
    value !== null &&
    "itemID" in value &&
    typeof (value as { itemID: unknown }).itemID === "number" &&
    "deferred" in value
  );
}

/** The window's IO, whatever shape it arrived in. */
export function unwrapCreatorExtDialogIO(
  value: unknown,
): CreatorExtDialogIO | null {
  const io = unwrapDialogIO<CreatorExtDialogIO>(value);
  return isCreatorExtDialogIO(io) ? io : null;
}
