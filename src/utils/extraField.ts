import { parseExtraLines, type ParsedExtraLine } from "./item";

/**
 * Pure helpers for reading and writing the `extra` field, free of host globals
 * (Zotero/ztoolkit); the interactive conflict prompt lives in
 * `src/modules/extraFieldWrite.ts`. Line classification is owned by `./item`.
 */

export type { ParsedExtraLine };

/**
 * Values of one normalized `extra` key, in file order. Repeated keys are read
 * (a community convention), never written.
 */
export function analyzeExtraField(
  extraText: string,
  normalizedKey: string,
): {
  values: string[];
} {
  const parsed = parseExtraLines(extraText);
  const values = parsed
    .filter((line) => line.normalizedKey === normalizedKey)
    .map((line) => line.value);
  return { values };
}

/**
 * Whether writing `value` over `existingValues` needs a user decision. An empty
 * list, or exactly the wanted value, writes straight away; anything else —
 * including repeated lines of one key — asks first.
 */
export function needsConflictDecision(
  existingValues: readonly string[],
  value: string,
): boolean {
  if (!existingValues.length) {
    return false;
  }
  if (existingValues.length > 1) {
    return true;
  }
  return existingValues[0] !== value;
}

function isPair(line: ParsedExtraLine): boolean {
  return line.normalizedKey !== null;
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start++;
  while (end > start && !lines[end - 1].trim()) end--;
  return lines.slice(start, end);
}

/**
 * Write one `extra` line, keeping the key/value block at the top of the field and
 * sorting it by normalized key, so citeproc reads the pairs before any prose. The
 * written key replaces the first occurrence and collapses any remaining
 * duplicates; a replaced line is written back in the modern `Key: value` form.
 */
export function mergeExtraField(
  extraText: string,
  writeKey: string,
  normalizedKey: string,
  value: string,
): string {
  const newline = extraText.includes("\r\n") ? "\r\n" : "\n";
  const parsed = parseExtraLines(extraText);
  const newLine = `${writeKey}: ${value}`;

  const pairs: { key: string; raw: string }[] = [];
  const others: string[] = [];
  let written = false;

  for (const line of parsed) {
    if (!isPair(line)) {
      others.push(line.raw);
      continue;
    }
    if (line.normalizedKey === normalizedKey) {
      // Keep the first slot, drop the remaining duplicates.
      if (!written) {
        pairs.push({ key: normalizedKey, raw: newLine });
        written = true;
      }
      continue;
    }
    pairs.push({ key: line.normalizedKey!, raw: line.raw });
  }

  if (!written) {
    pairs.push({ key: normalizedKey, raw: newLine });
  }

  // `Array.prototype.sort` is stable in the supported engines (Firefox >= 115),
  // so lines sharing a key stay in their original order.
  pairs.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const pairLines = pairs.map((pair) => pair.raw);
  const restLines = trimBlankEdges(others);
  return [...pairLines, ...restLines].join(newline);
}
