/**
 * URI parsing and validation utilities for handling cross-library citations
 */

import { useL10n } from "./locale";

const t = useL10n();

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

  const [, librarySegment, localPrefix, libraryId, itemKey] = match;

  return {
    libraryType: librarySegment === "users" ? "user" : "group",
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

  return getCurrentUserURIPrefixes().some(
    (prefix) => uri === prefix || uri.startsWith(`${prefix}/`),
  );
}

/**
 * URIs of the current user's library, in both the synced and the local
 * (not-yet-synced) form. Only one of them is produced by
 * `Zotero.URI.getItemURI()` at a given moment, but documents keep the form
 * they were written with and Zotero only migrates URIs stored in its own
 * relations table on login (`Zotero.Relations.updateUser`), so both forms can
 * legitimately point at the current user's library.
 */
function getCurrentUserURIPrefixes(): string[] {
  return Array.from(
    new Set([Zotero.URI.getCurrentUserURI(), Zotero.URI.getLocalUserURI()]),
  );
}

/**
 * Alternate URI form of the same item, for URI lookups that depend on the
 * exact string (e.g. merge-tracking relation objects): a citation written
 * before the account was synced carries a local user URI, while the relation
 * may have been rewritten to the account URI later, or vice versa. URIs of
 * other users are never mapped onto the local library.
 */
function getEquivalentUserURIs(uri: string): string[] {
  const parsed = parseItemURI(uri);
  if (!parsed || parsed.libraryType !== "user" || !isCurrentUserLibrary(uri)) {
    return [];
  }

  const currentUserURI = Zotero.URI.getCurrentUserURI();
  const localUserURI = Zotero.URI.getLocalUserURI();
  if (currentUserURI === localUserURI) {
    return [];
  }

  const pairs: Array<[string, string]> = [
    [currentUserURI, localUserURI],
    [localUserURI, currentUserURI],
  ];
  for (const [from, to] of pairs) {
    if (uri.startsWith(`${from}/`)) {
      return [`${to}${uri.slice(from.length)}`];
    }
  }

  return [];
}

/**
 * Resolve the item that replaced `uri` when duplicates were merged, by
 * following the merge-tracking relation (`dc:replaces`) that Zotero adds to
 * the surviving item. Mirrors the lookup order of
 * `Zotero.Integration.URIMap.prototype.getZoteroItemForURIs`, and keeps
 * working after the trashed duplicate is erased, since Zotero deliberately
 * preserves merge-tracking relations.
 *
 * @param uri - Item URI that may have been merged into another item
 * @returns The surviving item, or null if the URI was not replaced
 */
export async function getReplacingItemForURI(
  uri: string,
): Promise<Zotero.Item | null> {
  for (const candidate of [uri, ...getEquivalentUserURIs(uri)]) {
    try {
      const replacers = await Zotero.Relations.getByPredicateAndObject(
        "item",
        Zotero.Relations.replacedItemPredicate,
        candidate,
      );
      const replacer = replacers.find((item) => !item.deleted);
      if (replacer) {
        return replacer;
      }
    } catch {
      // Relation lookup failed for this candidate, try the next one.
    }
  }

  return null;
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

  let item: Zotero.Item | null = null;

  // Try to get the item
  try {
    item = await Zotero.URI.getURIItem(uri);
  } catch {
    // Item not found, continue to check why
  }

  if (item && !item.deleted) {
    return { accessible: true, parsed };
  }

  // Merged duplicates are trashed, but the surviving item carries a
  // `dc:replaces` relation pointing at their URI, so citations that resolve
  // through that relation are still accessible and must not be reported as
  // deleted.
  if (await getReplacingItemForURI(uri)) {
    return { accessible: true, parsed };
  }

  // The URI resolves to a trashed item, so it does belong to a reachable
  // library and the item itself is what's missing.
  if (item) {
    return { accessible: false, reason: "deleted", parsed };
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
      return t("inaccessible-items-desc-deleted");
    case "cross-library":
      return t("inaccessible-items-desc-cross-library");
    case "unknown-group":
      return t("inaccessible-items-desc-unknown-group");
    case "invalid-uri":
      return t("inaccessible-items-desc-invalid-uri");
  }
}
