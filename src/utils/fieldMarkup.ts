/**
 * Field-local rich-text markup for Zotero item fields.
 *
 * Zotero stores a restricted, literal tag set; this module parses only that
 * set (plus `<strong>`/`<em>` as HTML-standard synonyms) and never emits the
 * non-standard `<sc>`/`<nc>` forms. Unknown paired tags make the field
 * read-only instead of being guessed at.
 */

export type FieldMark =
  "bold" | "italic" | "superscript" | "subscript" | "smallCaps" | "noCase";

export type FieldRun = {
  text: string;
  marks: readonly FieldMark[];
  /** Start/end in the visible text (end exclusive). */
  visibleStart: number;
  visibleEnd: number;
  /** Start/end in the raw source, for source-selection mapping. */
  rawStart: number;
  rawEnd: number;
};

export type FieldMarkupErrorKind = "unbalanced" | "crossing" | "unsupported";

export type FieldMarkupError = {
  kind: FieldMarkupErrorKind;
  message: string;
  tags?: readonly string[];
};

export type FieldMarkup = {
  runs: readonly FieldRun[];
  visibleText: string;
  raw: string;
  error?: FieldMarkupError;
};

const ORDER: readonly FieldMark[] = [
  "bold",
  "italic",
  "superscript",
  "subscript",
  "smallCaps",
  "noCase",
];

const OPENERS: Record<FieldMark, string> = {
  bold: "<b>",
  italic: "<i>",
  superscript: "<sup>",
  subscript: "<sub>",
  smallCaps: '<span style="font-variant:small-caps;">',
  noCase: '<span class="nocase">',
};

const CLOSERS: Record<FieldMark, string> = {
  bold: "</b>",
  italic: "</i>",
  superscript: "</sup>",
  subscript: "</sub>",
  smallCaps: "</span>",
  noCase: "</span>",
};

/** Tags Zotero's own renderer/search/sort recognizes. */
const NO_ATTR_TAGS: Record<string, FieldMark> = {
  b: "bold",
  strong: "bold",
  i: "italic",
  em: "italic",
  sup: "superscript",
  sub: "subscript",
};

const TAG_RE = /<\/?([a-z][a-z0-9-]*)([^>]*)>/gi;

function marksOf(stack: readonly (readonly FieldMark[])[]): FieldMark[] {
  const out: FieldMark[] = [];
  for (const marks of stack) {
    for (const mark of marks) {
      if (!out.includes(mark)) out.push(mark);
    }
  }
  return out;
}

function sameMarks(a: readonly FieldMark[], b: readonly FieldMark[]): boolean {
  return a.length === b.length && a.every((mark) => b.includes(mark));
}

function pushRun(
  runs: FieldRun[],
  text: string,
  marks: readonly FieldMark[],
  rawStart: number,
  visibleStart: number,
): void {
  if (!text) return;
  const last = runs[runs.length - 1];
  if (last && sameMarks(last.marks, marks)) {
    runs[runs.length - 1] = {
      ...last,
      text: last.text + text,
      visibleEnd: visibleStart + text.length,
      rawEnd: rawStart + text.length,
    };
    return;
  }
  runs.push({
    text,
    marks: [...marks],
    visibleStart,
    visibleEnd: visibleStart + text.length,
    rawStart,
    rawEnd: rawStart + text.length,
  });
}

function parseSpanMark(attrs: string): FieldMark | null {
  const classMatch = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
  const className = classMatch?.[1] ?? classMatch?.[2] ?? "";
  if (/(?:^|\s)nocase(?:\s|$)/i.test(className)) {
    return "noCase";
  }
  const styleMatch = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
  const style = styleMatch?.[1] ?? styleMatch?.[2] ?? "";
  if (/(?:^|;)\s*font-variant\s*:\s*small-caps\s*(?:;|$)/i.test(style.trim())) {
    return "smallCaps";
  }
  return null;
}

/**
 * Reject paired unknown tags before tokenizing. Unlike prose with a lone `<`,
 * a complete `<a>...</a>` or `<span style="color:…">...</span>` is data we must
 * not rewrite.
 */
function findUnsupportedTags(raw: string): string[] | null {
  const tags = new Set<string>();
  const pairRe = /<\s*([a-z][a-z0-9-]*)([^>]*)>[\s\S]*?<\/\s*\1\s*>/gi;
  for (const match of raw.matchAll(pairRe)) {
    const name = match[1].toLowerCase();
    const attrs = match[2];
    if (NO_ATTR_TAGS[name]) {
      if (attrs.trim()) tags.add(name);
      continue;
    }
    if (name === "span") {
      if (!parseSpanMark(attrs)) tags.add("span");
      continue;
    }
    tags.add(name);
  }
  // Void/self-closing tags that Zotero never renders as field markup.
  for (const match of raw.matchAll(/<\s*([a-z][a-z0-9-]*)\b[^>]*\/?\s*>/gi)) {
    const name = match[1].toLowerCase();
    if (name === "br" || name === "img" || name === "hr") {
      tags.add(name);
    }
  }
  return tags.size ? [...tags] : null;
}

/** Parse a field value into visible runs. */
export function parseFieldMarkup(raw: string): FieldMarkup {
  const unsupported = findUnsupportedTags(raw);
  if (unsupported) {
    return {
      runs: [],
      visibleText: "",
      raw,
      error: {
        kind: "unsupported",
        message: `Unsupported tag(s): ${unsupported.join(", ")}`,
        tags: unsupported,
      },
    };
  }

  const runs: FieldRun[] = [];
  const stack: { tag: string; marks: readonly FieldMark[] }[] = [];
  let visible = 0;
  let cursor = 0;

  const flushText = (end: number): void => {
    if (end > cursor) {
      const text = raw.slice(cursor, end);
      pushRun(
        runs,
        text,
        marksOf(stack.map((entry) => entry.marks)),
        cursor,
        visible,
      );
      visible += text.length;
    }
    cursor = end;
  };

  const fail = (kind: FieldMarkupErrorKind, message: string): FieldMarkup => ({
    runs: [],
    visibleText: "",
    raw,
    error: { kind, message },
  });

  for (const match of raw.matchAll(TAG_RE)) {
    const full = match[0];
    const name = match[1].toLowerCase();
    const attrs = match[2];
    const closing = full.startsWith("</");
    const at = match.index ?? 0;

    if (name === "sc" || name === "nc") {
      return fail("unsupported", `Unsupported tag: <${name}>`);
    }

    let mark: FieldMark | null = null;
    if (!closing) {
      if (NO_ATTR_TAGS[name]) {
        if (attrs.trim()) continue; // prose like `<b and 2 >`, not a tag
        mark = NO_ATTR_TAGS[name];
      } else if (name === "span") {
        mark = parseSpanMark(attrs);
        if (!mark) {
          return fail("unsupported", "Unsupported span attributes");
        }
      } else {
        continue; // unknown lone tag: leave it in the text run
      }
    } else if (!NO_ATTR_TAGS[name] && name !== "span") {
      continue; // unknown lone closing tag: leave it in the text run
    }

    flushText(at);
    cursor = at + full.length;

    if (closing) {
      const top = stack[stack.length - 1];
      if (!top) {
        return fail("unbalanced", `Unexpected closing tag </${name}>`);
      }
      if (top.tag !== name) {
        return fail(
          "crossing",
          `Crossing tags: </${name}> closes <${top.tag}>`,
        );
      }
      stack.pop();
    } else {
      stack.push({ tag: name, marks: [mark as FieldMark] });
    }
  }

  flushText(raw.length);
  if (stack.length) {
    const open = stack.map((entry) => `<${entry.tag}>`).join(", ");
    return fail("unbalanced", `Unclosed tag(s): ${open}`);
  }

  return { runs, visibleText: runs.map((run) => run.text).join(""), raw };
}

/** Serialize runs to the canonical Zotero markup. */
export function serializeFieldMarkup(runs: readonly FieldRun[]): string {
  let out = "";
  for (const run of runs) {
    let text = run.text;
    if (!text) continue;
    for (const mark of [...ORDER].reverse()) {
      if (run.marks.includes(mark)) {
        text = OPENERS[mark] + text + CLOSERS[mark];
      }
    }
    out += text;
  }
  return out;
}

function normalizeRange(
  visibleText: string,
  start: number,
  end: number,
): [number, number] {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.min(visibleText.length, Math.max(start, end));
  return [from, to];
}

function hasText(visibleText: string, start: number, end: number): boolean {
  return visibleText.slice(start, end).trim().length > 0;
}

function isCovered(
  runs: readonly FieldRun[],
  start: number,
  end: number,
  mark: FieldMark,
): boolean {
  for (const run of runs) {
    const from = Math.max(start, run.visibleStart);
    const to = Math.min(end, run.visibleEnd);
    if (from >= to) continue;
    if (!run.marks.includes(mark)) return false;
  }
  return true;
}

function splitRun(run: FieldRun, start: number, end: number): FieldRun[] {
  const pieces: FieldRun[] = [];
  const push = (from: number, to: number): void => {
    if (from >= to) return;
    const text = run.text.slice(from - run.visibleStart, to - run.visibleStart);
    pieces.push({
      text,
      marks: run.marks,
      visibleStart: from,
      visibleEnd: to,
      rawStart: run.rawStart + (from - run.visibleStart),
      rawEnd: run.rawStart + (to - run.visibleStart),
    });
  };
  push(run.visibleStart, Math.max(run.visibleStart, start));
  push(Math.max(run.visibleStart, start), Math.min(run.visibleEnd, end));
  push(Math.min(run.visibleEnd, end), run.visibleEnd);
  return pieces;
}

function mergeRuns(runs: readonly FieldRun[]): FieldRun[] {
  const out: FieldRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const last = out[out.length - 1];
    if (last && sameMarks(last.marks, run.marks)) {
      out[out.length - 1] = {
        ...last,
        text: last.text + run.text,
        visibleEnd: run.visibleEnd,
        rawEnd: run.rawEnd,
      };
    } else {
      out.push({ ...run, marks: [...run.marks] });
    }
  }
  return out;
}

/** Toggle one mark over a visible-text range. */
export function toggleFieldMark(
  runs: readonly FieldRun[],
  range: readonly [number, number],
  mark: FieldMark,
): FieldRun[] {
  const visibleText = runs.map((run) => run.text).join("");
  const [start, end] = normalizeRange(visibleText, range[0], range[1]);
  if (start >= end || !hasText(visibleText, start, end)) {
    return mergeRuns(runs);
  }

  const remove = isCovered(runs, start, end, mark);
  const next: FieldRun[] = [];
  for (const run of runs) {
    if (run.visibleEnd <= start || run.visibleStart >= end) {
      next.push(run);
      continue;
    }
    for (const piece of splitRun(run, start, end)) {
      const inRange = piece.visibleStart >= start && piece.visibleEnd <= end;
      if (!inRange) {
        next.push(piece);
        continue;
      }
      let marks = piece.marks.filter((candidate) => candidate !== mark);
      if (!remove) {
        if (mark === "superscript") {
          marks = marks.filter((candidate) => candidate !== "subscript");
        } else if (mark === "subscript") {
          marks = marks.filter((candidate) => candidate !== "superscript");
        }
        marks = [...marks, mark];
      }
      next.push({ ...piece, marks });
    }
  }
  return mergeRuns(next);
}

/** Remove all supported marks from a visible-text range. */
export function clearFieldMarks(
  runs: readonly FieldRun[],
  range: readonly [number, number],
): FieldRun[] {
  const visibleText = runs.map((run) => run.text).join("");
  const [start, end] = normalizeRange(visibleText, range[0], range[1]);
  const next: FieldRun[] = [];
  for (const run of runs) {
    if (run.visibleEnd <= start || run.visibleStart >= end) {
      next.push(run);
      continue;
    }
    for (const piece of splitRun(run, start, end)) {
      const inRange = piece.visibleStart >= start && piece.visibleEnd <= end;
      next.push(inRange ? { ...piece, marks: [] } : piece);
    }
  }
  return mergeRuns(next);
}

/** Marks common to every visible character in the range. */
export function getActiveMarks(
  runs: readonly FieldRun[],
  range: readonly [number, number],
): Set<FieldMark> {
  const visibleText = runs.map((run) => run.text).join("");
  const [start, end] = normalizeRange(visibleText, range[0], range[1]);
  const active = new Set<FieldMark>();
  if (start >= end) return active;
  for (const mark of ORDER) {
    if (isCovered(runs, start, end, mark)) active.add(mark);
  }
  return active;
}

/** Number of runs carrying each mark, for list badges. */
export function countFieldMarks(
  runs: readonly FieldRun[],
): Partial<Record<FieldMark, number>> {
  const counts: Partial<Record<FieldMark, number>> = {};
  for (const run of runs) {
    for (const mark of run.marks) {
      counts[mark] = (counts[mark] ?? 0) + 1;
    }
  }
  return counts;
}
