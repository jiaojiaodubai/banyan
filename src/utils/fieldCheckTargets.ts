/**
 * Extract the field names a field-check message names.
 *
 * `ITEM_FIELD_VALIDATORS` results are free-form prose, so the host can only
 * recover targets from the messages themselves. Style authors conventionally
 * write the localized label in 「」 and the Zotero field/extra key in （）,
 * e.g. `请填「地点」（place）`, or an extra key in backticks.
 */
const QUOTED_PATTERNS: readonly RegExp[] = [
  /「([^」]*)」/gu,
  /“([^”]*)”/gu,
  /`([^`]*)`/gu,
  /（([^（）]*)）/gu,
  /\(([^()]*)\)/gu,
];

const SPLIT_PATTERN = /或|、|\/|,|，|\||:|：/u;

function addCandidate(out: Set<string>, raw: string): void {
  const text = raw.trim();
  if (!text) return;
  out.add(text);
  for (const part of text.split(SPLIT_PATTERN)) {
    const candidate = part.trim();
    if (candidate) out.add(candidate);
  }
}

/** Field/extra-key candidates named in one check message, in text order. */
export function extractFieldCheckTargets(text: string): string[] {
  const out = new Set<string>();
  for (const pattern of QUOTED_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      addCandidate(out, match[1] ?? "");
    }
  }
  return [...out];
}
