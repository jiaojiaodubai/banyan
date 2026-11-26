/**
 * Line model for Zotero's `extra` variable lines.
 *
 * The item editor shows every modern `Key: value` line as an editable row and
 * keeps everything it cannot edit (prose, blank lines, legacy cheater syntax)
 * in one raw "Other" block. Lines whose key is owned by the plugin (currently
 * `creators-ext`, and any future machine-written data) are hidden from the UI
 * and written back byte-for-byte.
 */
import {
  isValidExtraKey,
  normalizeExtraKey,
  parseExtraLine,
  toTitleCaseExtraKey,
} from "@banyan/core/items/extra";

export type ExtraPair = {
  lineIndex: number;
  keyRaw: string;
  normalizedKey: string;
  /** Text before the value, including the colon and following whitespace. */
  prefix: string;
  value: string;
  valueStart: number;
  valueEnd: number;
};

/**
 * Keys the plugin writes itself and must not expose in the item editor.
 * Add future machine-readable `extra` data here.
 */
export const MANAGED_EXTRA_KEYS: ReadonlySet<string> = new Set([
  "creators-ext",
]);

/** Suggestions for a new or edited key, in display order. */
export const EXTRA_KEY_SUGGESTIONS: readonly string[] = [
  "Type",
  "Genre",
  "Status",
];

export type ExtraDocumentRow = {
  key: string;
  value: string;
  /** Whether this value can carry field-local rich-text markup. */
  markable: boolean;
  /** Original line, reused while the row is unchanged. */
  rawLine?: string;
  rawKey?: string;
  rawValue?: string;
};

export type ExtraEditorDocument = {
  rows: ExtraDocumentRow[];
  /** Prose, blank lines and legacy cheater syntax, in file order. */
  other: string;
  /** Raw lines of managed keys, hidden from the editor. */
  managedLines: string[];
  newline: "\n" | "\r\n";
};

const PAIR_PATTERN = /^([\p{L}][\p{L}\p{N} _-]*?)[ \t]*:[ \t]*(\S.*)$/u;

/**
 * extra keys whose values are CSL/CSL-M switches, identifiers, or date
 * variables. `edition`, `volume` and `version` are intentionally absent:
 * Zotero documents Edition/Volume as text-capable, and CSL defines `version`
 * as a string variable. A number variable may still contain non-numeric text,
 * which CSL renders as-is (`Edition: Special edition`).
 *
 * CSL string variables (`genre`, `medium`, `status`) are editable too; only
 * keys that select a type/locale/jurisdiction (or that are lookup keys) are
 * excluded.
 */
const NON_EDITABLE_EXTRA_KEYS: ReadonlySet<string> = new Set([
  "creators-ext",
  "type",
  "language",
  "jurisdiction",
  "authority",
  "citation-key",
  "tex.ids",
  "doi",
  "isbn",
  "issn",
  "pmid",
  "pmcid",
  "url",
  "issued",
  "accessed",
  "original-date",
  "event-date",
  "submitted",
  "issue",
  "page",
  "page-first",
  "number",
  "number-of-pages",
  "number-of-volumes",
  "chapter-number",
  "collection-number",
  "part-number",
  "supplement-number",
  "printing-number",
  "citation-number",
  "first-reference-note-number",
  "year-suffix",
]);

function splitLines(extraText: string): {
  lines: string[];
  newline: "\n" | "\r\n";
} {
  const newline = extraText.includes("\r\n") ? "\r\n" : "\n";
  return { lines: extraText.split(/\r?\n/), newline };
}

function parsePairLine(line: string, lineIndex: number): ExtraPair | null {
  const match = line.match(PAIR_PATTERN);
  if (!match) return null;
  const keyRaw = match[1];
  const value = match[2];
  const valueStart = line.lastIndexOf(value);
  if (valueStart < 0) return null;
  return {
    lineIndex,
    keyRaw,
    normalizedKey: normalizeExtraKey(keyRaw),
    prefix: line.slice(0, valueStart),
    value,
    valueStart,
    valueEnd: valueStart + value.length,
  };
}

/** Modern `Key: value` pairs, in file order. Legacy lines are skipped. */
export function parseExtraPairs(extraText: string): ExtraPair[] {
  const { lines } = splitLines(extraText);
  const pairs: ExtraPair[] = [];
  lines.forEach((line, lineIndex) => {
    const pair = parsePairLine(line, lineIndex);
    if (pair) pairs.push(pair);
  });
  return pairs;
}

/** Whether this pair's value can be marked without breaking a CSL switch. */
export function isEditableExtraPair(pair: ExtraPair): boolean {
  return isMarkableExtraKey(pair.keyRaw);
}

/** Whether a key's value may carry field-local rich-text markup. */
export function isMarkableExtraKey(keyRaw: string): boolean {
  const normalizedKey = normalizeExtraKey(keyRaw);
  return isValidExtraKey(keyRaw) && !NON_EDITABLE_EXTRA_KEYS.has(normalizedKey);
}

/** Whether the plugin owns this key and must keep it out of the editor UI. */
export function isManagedExtraKey(keyRaw: string): boolean {
  const normalizedKey = normalizeExtraKey(keyRaw);
  return !!normalizedKey && MANAGED_EXTRA_KEYS.has(normalizedKey);
}

/** Replace one pair's value, preserving every other byte of `extra`. */
export function replaceExtraPairValue(
  extraText: string,
  pair: ExtraPair,
  newValue: string,
): string {
  const { lines, newline } = splitLines(extraText);
  const line = lines[pair.lineIndex];
  if (line === undefined) return extraText;
  lines[pair.lineIndex] = pair.prefix + newValue;
  return lines.join(newline);
}

/**
 * Split `extra` into editable rows, one raw "Other" block and the managed
 * lines the editor must preserve without showing them.
 */
export function parseExtraEditorDocument(
  extraText: string,
): ExtraEditorDocument {
  const { lines, newline } = splitLines(extraText);
  const rows: ExtraDocumentRow[] = [];
  const managedLines: string[] = [];
  const otherLines: string[] = [];

  lines.forEach((line, lineIndex) => {
    const coreLine = parseExtraLine(line);
    const normalizedKey = coreLine.normalizedKey;
    if (normalizedKey && MANAGED_EXTRA_KEYS.has(normalizedKey)) {
      managedLines.push(line);
      return;
    }
    // A managed line without a parsable value is still plugin data: hidden.
    const keyBeforeColon = line.match(
      /^[\p{L}][\p{L}\p{N} _-]*?(?=[ \t]*:)/u,
    )?.[0];
    if (keyBeforeColon && isManagedExtraKey(keyBeforeColon)) {
      managedLines.push(line);
      return;
    }

    const pair = parsePairLine(line, lineIndex);
    if (!pair) {
      otherLines.push(line);
      return;
    }
    rows.push({
      key: pair.keyRaw,
      value: pair.value,
      markable: isEditableExtraPair(pair),
      rawLine: line,
      rawKey: pair.keyRaw,
      rawValue: pair.value,
    });
  });

  return {
    rows,
    other: otherLines.join(newline),
    managedLines,
    newline,
  };
}

/**
 * Rebuild `extra` from the editor document.
 *
 * Unchanged rows keep their original line; edited/new rows are written in the
 * canonical `Title Case Key: value` form. Managed lines follow the visible
 * rows, and the raw "Other" block stays last so citeproc always sees the
 * key/value block before prose.
 */
export function serializeExtraEditorDocument(
  document: ExtraEditorDocument,
): string {
  const lines: string[] = [];
  for (const row of document.rows) {
    const key = row.key.trim();
    if (!key || !row.value.trim()) continue;
    if (
      row.rawLine !== undefined &&
      row.rawKey !== undefined &&
      row.rawValue !== undefined &&
      key === row.rawKey &&
      row.value === row.rawValue
    ) {
      lines.push(row.rawLine);
      continue;
    }
    lines.push(`${toTitleCaseExtraKey(key)}: ${row.value}`);
  }
  lines.push(...document.managedLines);
  if (document.other !== "") {
    // Normalize the block to the document's newline style without dropping
    // intentional blank lines inside it.
    lines.push(...document.other.split(/\r?\n/));
  }
  return lines.join(document.newline);
}

/**
 * Keys whose suggestion should be offered for `query`, excluding keys already
 * used by other rows. The row being edited keeps the suggestion for its own
 * key so it does not disappear while editing.
 */
export function getExtraKeySuggestions(
  rows: readonly { key: string }[],
  query: string,
  currentKey: string | null = null,
): string[] {
  const ownKey = normalizeExtraKey(currentKey ?? "");
  const used = new Set(
    rows
      .map((row) => normalizeExtraKey(row.key))
      .filter((key) => key && key !== ownKey),
  );
  const input = query.trim();
  const normalizedInput = normalizeExtraKey(input);
  return EXTRA_KEY_SUGGESTIONS.filter((suggestion) => {
    const normalized = normalizeExtraKey(suggestion);
    if (used.has(normalized)) return false;
    if (!input) return true;
    return (
      normalized.startsWith(normalizedInput) ||
      suggestion.toLowerCase().startsWith(input.toLowerCase())
    );
  });
}
