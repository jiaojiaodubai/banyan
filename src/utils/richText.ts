import type { InlineMark, RichText, TextUnit } from "../../typings/unit";

type MarkValue = InlineMark["value"];
type MarkType = InlineMark["type"];
type MarkRangeInput = {
  type: MarkType;
  start: number;
  end: number;
  value: MarkValue;
};

const MARK_ORDER: Record<MarkType, number> = {
  bold: 0,
  italic: 1,
  script: 2,
  color: 3,
  backgroundColor: 4,
  link: 5,
};

export type RichTextRun = TextUnit & {
  link?: string;
};

export type RichTextSegment = TextUnit & {
  start: number;
  end: number;
  link?: string;
};

export function emptyRichText(): RichText {
  return { text: "", marks: [] };
}

export function textToRichText(text: string): RichText {
  return { text, marks: [] };
}

export function richTextFromRuns(units: readonly RichTextRun[]): RichText {
  const markRuns = new Map<string, MarkRangeInput[]>();
  let text = "";
  let offset = 0;

  const pushMark = (mark: MarkRangeInput): void => {
    if (mark.start >= mark.end) return;
    const key = `${mark.type}\u0000${String(mark.value)}`;
    const runs = markRuns.get(key);
    if (!runs) {
      markRuns.set(key, [mark]);
      return;
    }

    const last = runs[runs.length - 1];
    if (last.end === mark.start) {
      last.end = mark.end;
      return;
    }
    runs.push(mark);
  };

  for (const unit of units) {
    const value = unit.value ?? "";
    if (!value) continue;

    const start = offset;
    const end = start + value.length;
    text += value;
    offset = end;

    if (typeof unit.bold === "boolean") {
      pushMark({ type: "bold", start, end, value: unit.bold });
    }
    if (typeof unit.italic === "boolean") {
      pushMark({ type: "italic", start, end, value: unit.italic });
    }
    if (unit.script) {
      pushMark({ type: "script", start, end, value: unit.script });
    }
    if (unit.color) {
      pushMark({ type: "color", start, end, value: unit.color });
    }
    if (unit.backgroundColor) {
      pushMark({
        type: "backgroundColor",
        start,
        end,
        value: unit.backgroundColor,
      });
    }
    if (unit.link) {
      pushMark({ type: "link", start, end, value: unit.link });
    }
  }

  return {
    text,
    marks: Array.from(markRuns.values())
      .flat()
      .map(toInlineMark)
      .sort(compareInlineMarks),
  };
}

export function getRichTextSegments(input: RichText): RichTextSegment[] {
  const text = typeof input.text === "string" ? input.text : "";
  if (!text) {
    return [];
  }

  const boundaries = new Set<number>([0, text.length]);
  const marks = normalizeMarks(input.marks, text.length);
  for (const mark of marks) {
    boundaries.add(mark.start);
    boundaries.add(mark.end);
  }

  const offsets = Array.from(boundaries).sort((a, b) => a - b);
  const segments: RichTextSegment[] = [];
  for (let index = 0; index < offsets.length - 1; index++) {
    const start = offsets[index];
    const end = offsets[index + 1];
    if (start >= end) continue;

    const segment: RichTextSegment = {
      start,
      end,
      value: text.slice(start, end),
    };

    for (const mark of marks) {
      if (mark.start > start || mark.end < end) continue;
      applyMarkToSegment(segment, mark);
    }

    if (segment.value) {
      pushMergedSegment(segments, segment);
    }
  }
  return segments;
}

export function normalizeRichText(input: unknown): RichText | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const record = input as Record<string, unknown>;
  if (typeof record.text !== "string" || !Array.isArray(record.marks)) {
    return null;
  }
  return {
    text: record.text,
    marks: normalizeMarks(record.marks, record.text.length),
  };
}

function normalizeMarks(input: unknown, textLength: number): InlineMark[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const marks: InlineMark[] = [];
  for (const raw of input) {
    const mark = normalizeMark(raw, textLength);
    if (mark) {
      marks.push(mark);
    }
  }

  return marks.sort(compareInlineMarks);
}

function normalizeMark(input: unknown, textLength: number): InlineMark | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const record = input as Record<string, unknown>;
  const type = record.type;
  const start = normalizeOffset(record.start, textLength);
  const end = normalizeOffset(record.end, textLength);
  if (!start.ok || !end.ok || start.value >= end.value) {
    return null;
  }

  switch (type) {
    case "bold":
    case "italic":
      return typeof record.value === "boolean"
        ? { type, start: start.value, end: end.value, value: record.value }
        : null;
    case "script":
      return record.value === "superscript" || record.value === "subscript"
        ? { type, start: start.value, end: end.value, value: record.value }
        : null;
    case "color":
    case "backgroundColor":
    case "link":
      return typeof record.value === "string" && record.value
        ? { type, start: start.value, end: end.value, value: record.value }
        : null;
    default:
      return null;
  }
}

function normalizeOffset(
  value: unknown,
  textLength: number,
): { ok: true; value: number } | { ok: false } {
  if (!Number.isInteger(value)) {
    return { ok: false };
  }

  const offset = value as number;
  if (offset < 0 || offset > textLength) {
    return { ok: false };
  }
  return { ok: true, value: offset };
}

function toInlineMark(mark: MarkRangeInput): InlineMark {
  switch (mark.type) {
    case "bold":
    case "italic":
      return {
        type: mark.type,
        start: mark.start,
        end: mark.end,
        value: Boolean(mark.value),
      };
    case "script":
      return {
        type: "script",
        start: mark.start,
        end: mark.end,
        value:
          mark.value === "subscript" || mark.value === "superscript"
            ? mark.value
            : "superscript",
      };
    case "color":
    case "backgroundColor":
    case "link":
      return {
        type: mark.type,
        start: mark.start,
        end: mark.end,
        value: String(mark.value),
      };
  }
}

function compareInlineMarks(a: InlineMark, b: InlineMark): number {
  return (
    a.start - b.start ||
    a.end - b.end ||
    MARK_ORDER[a.type] - MARK_ORDER[b.type] ||
    String(a.value).localeCompare(String(b.value))
  );
}

function applyMarkToSegment(segment: RichTextSegment, mark: InlineMark): void {
  switch (mark.type) {
    case "bold":
      segment.bold = mark.value;
      break;
    case "italic":
      segment.italic = mark.value;
      break;
    case "script":
      segment.script = mark.value;
      break;
    case "color":
      segment.color = mark.value;
      break;
    case "backgroundColor":
      segment.backgroundColor = mark.value;
      break;
    case "link":
      segment.link = mark.value;
      break;
  }
}

function pushMergedSegment(
  segments: RichTextSegment[],
  segment: RichTextSegment,
): void {
  const last = segments[segments.length - 1];
  if (
    last &&
    last.end === segment.start &&
    last.bold === segment.bold &&
    last.italic === segment.italic &&
    last.script === segment.script &&
    last.color === segment.color &&
    last.backgroundColor === segment.backgroundColor &&
    last.link === segment.link
  ) {
    last.value += segment.value;
    last.end = segment.end;
    return;
  }
  segments.push(segment);
}
