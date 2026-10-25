/**
 * The one decoder for Banyan's opaque item handle.
 *
 * The core promises only a string; this plugin's handles are Zotero's numeric
 * itemIDs in string form, and the `z:uri` extension key is the durable
 * reference. Every consumer that still needs the numeric id (item
 * lookup, highlighting, cited-items search) must come through here so the rule
 * cannot drift between modules.
 */
export function decodeZoteroItemId(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}
