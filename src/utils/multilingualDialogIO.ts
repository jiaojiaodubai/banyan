import type { MultilingualItemDialogIO } from "../../typings/multilingualItemDialog";

/** Guard for the IO object both sides read out of `window.arguments[0]`. */
export function isMultilingualDialogIO(
  value: unknown,
): value is MultilingualItemDialogIO {
  if (typeof value !== "object" || value === null) return false;
  if (
    !("sourceItem" in value) ||
    typeof value.sourceItem !== "object" ||
    value.sourceItem === null
  ) {
    return false;
  }
  return (
    "id" in value.sourceItem &&
    typeof value.sourceItem.id === "number" &&
    "getField" in value.sourceItem &&
    typeof value.sourceItem.getField === "function" &&
    "result" in value &&
    "deferred" in value &&
    typeof value.deferred === "object" &&
    value.deferred !== null &&
    "resolve" in value.deferred &&
    typeof value.deferred.resolve === "function" &&
    "findDuplicate" in value &&
    typeof value.findDuplicate === "function"
  );
}

/**
 * Unwrap the IO from `window.arguments[0]`: Gecko may hand it over
 * Xray-wrapped (`wrappedJSObject`) depending on how the window was opened.
 */
export function unwrapMultilingualDialogIO(
  value: unknown,
): MultilingualItemDialogIO | null {
  if (isMultilingualDialogIO(value)) return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "wrappedJSObject" in value &&
    isMultilingualDialogIO(value.wrappedJSObject)
  ) {
    return value.wrappedJSObject;
  }
  return null;
}
