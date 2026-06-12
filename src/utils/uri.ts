/**
 * URI parsing and validation utilities for handling cross-library citations
 */

export type ParsedItemURI = {
  libraryType: "user" | "group";
  libraryId: string; // userID or groupID
  isLocal: boolean; // true if local user (not synced)
  itemKey: string;
  raw: string;
};

/**
 * Parse a Zotero item URI into its components
 *
 * URI format:
 * - User library: http://zotero.org/users/{userID}/items/{itemKey}
 * - Local user: http://zotero.org/users/local/{localUserKey}/items/{itemKey}
 * - Group library: http://zotero.org/groups/{groupID}/items/{itemKey}
 *
 * @param uri - The item URI to parse
 * @returns Parsed URI components, or null if invalid
 */
export function parseItemURI(uri: string): ParsedItemURI | null {
  // Match Zotero URI pattern
  // Groups: 1=users|groups, 2=local/|null, 3=userID|groupID|localUserKey, 4=itemKey
  const uriPattern =
    /^http:\/\/zotero\.org\/(users|groups)\/(local\/)?(\w+)(?:\/(?:publications|feeds\/\w+))?\/items\/(\w+)$/;

  const match = uri.match(uriPattern);
  if (!match) {
    return null;
  }

  const [, libraryType, localPrefix, libraryId, itemKey] = match;

  return {
    libraryType: libraryType as "user" | "group",
    libraryId,
    isLocal: Boolean(localPrefix),
    itemKey,
    raw: uri,
  };
}

/**
 * Check if an item URI belongs to the current user's library
 *
 * @param uri - The item URI to check
 * @returns true if the URI belongs to current user's library
 */
export function isCurrentUserLibrary(uri: string): boolean {
  const parsed = parseItemURI(uri);
  if (!parsed) {
    return false;
  }

  // Only user libraries can be "current user"
  if (parsed.libraryType !== "user") {
    return false;
  }

  // Get current user ID
  const currentUserID = Zotero.Users.getCurrentUserID();

  // If user is synced, compare user IDs
  if (currentUserID && !parsed.isLocal) {
    return parsed.libraryId === String(currentUserID);
  }

  // If user is not synced, compare local user keys
  if (!currentUserID && parsed.isLocal) {
    const localUserKey = Zotero.Users.getLocalUserKey();
    return parsed.libraryId === localUserKey;
  }

  // Mixed sync state (one synced, one local) - not the same user
  return false;
}

/**
 * Check if an item URI belongs to a group library accessible by current user
 *
 * @param uri - The item URI to check
 * @returns true if the URI belongs to an accessible group
 */
export function isAccessibleGroupLibrary(uri: string): boolean {
  const parsed = parseItemURI(uri);
  if (!parsed || parsed.libraryType !== "group") {
    return false;
  }

  try {
    const groupID = parseInt(parsed.libraryId, 10);
    const group = Zotero.Groups.get(groupID);
    return Boolean(group);
  } catch {
    return false;
  }
}

/**
 * Categorize why an item URI is inaccessible
 */
export type InaccessibleReason =
  | "deleted" // Item was deleted from the library
  | "cross-library" // Item is from a different user's library
  | "unknown-group" // Item is from a group the user doesn't have access to
  | "invalid-uri"; // URI format is invalid

export type URIAccessibility = {
  accessible: boolean;
  reason?: InaccessibleReason;
  parsed?: ParsedItemURI;
};

/**
 * Check if an item URI is accessible in the current Zotero instance
 *
 * @param uri - The item URI to check
 * @returns Accessibility status with reason if inaccessible
 */
export async function checkURIAccessibility(
  uri: string,
): Promise<URIAccessibility> {
  const parsed = parseItemURI(uri);
  if (!parsed) {
    return { accessible: false, reason: "invalid-uri" };
  }

  // Try to get the item
  try {
    const item = await Zotero.URI.getURIItem(uri);
    if (item && !item.deleted) {
      return { accessible: true, parsed };
    }
    if (item && item.deleted) {
      return { accessible: false, reason: "deleted", parsed };
    }
  } catch {
    // Item not found, continue to check why
  }

  // Check if it's a cross-library reference
  if (parsed.libraryType === "user" && !isCurrentUserLibrary(uri)) {
    return { accessible: false, reason: "cross-library", parsed };
  }

  if (parsed.libraryType === "group" && !isAccessibleGroupLibrary(uri)) {
    return { accessible: false, reason: "unknown-group", parsed };
  }

  // Item exists in an accessible library but was deleted
  return { accessible: false, reason: "deleted", parsed };
}

/**
 * Get a human-readable description of why a URI is inaccessible
 */
export function getInaccessibilityDescription(
  reason: InaccessibleReason,
): string {
  switch (reason) {
    case "deleted":
      return "The item has been deleted from the library";
    case "cross-library":
      return "The item is from another user's personal library";
    case "unknown-group":
      return "The item is from a group library you don't have access to";
    case "invalid-uri":
      return "The item URI format is invalid";
  }
}
