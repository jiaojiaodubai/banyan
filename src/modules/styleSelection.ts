/**
 * Pick the style a chooser should preselect: the caller's explicit request
 * first, then the shared item-menu style / last-used style, then the first
 * style in the list. Missing ids are ignored instead of selected blindly.
 */
export function pickDefaultStyleId(
  styleIds: readonly string[],
  requestedId?: string,
  preferredId?: string,
): string | null {
  if (requestedId && styleIds.includes(requestedId)) {
    return requestedId;
  }
  if (preferredId && styleIds.includes(preferredId)) {
    return preferredId;
  }
  return styleIds[0] ?? null;
}
