import type {
  BibliographyLine,
  Citation,
  CitationContext,
  CitationSource,
  ScriptIntextCitation,
  ScriptNoteCitation,
  Style,
} from "../../../typings/style";
import type {
  AffixUnit,
  FallbackUnit,
  GroupUnit,
  LinkUnit,
  RichText,
  TextCaseForm,
  TextCaseUnit,
  TextUnit,
  Unit,
  WhenUnit,
  WithStyleUnit,
} from "../../../typings/unit";
import { applyTextCase, normalizeTextValue } from "../unit";
import { sanitizeLink } from "../../utils/html";
import { richTextFromRuns, RichTextRun } from "../../utils/richText";
import { normalizeUnitInput } from "../sandboxUtils";
import { createBanyanRuntimeError } from "./runtimeErrors";

const MAX_OUTPUT_ARRAY_LENGTH = 10_000;
const MAX_TEXT_UNIT_VALUE_LENGTH = 20_000;
const MAX_OUTPUT_TEXT_LENGTH = 2_000_000;
type OutputBudget = {
  textLength: number;
};

type InternalTextUnit = RichTextRun & {
  smallCaps?: boolean;
  noCase?: boolean;
};
type InternalTextStyle = Omit<InternalTextUnit, "value">;

/**
 * Validate and normalize the raw output of `generate()`.
 * Expects `{ citations: [...], bibliography: [...] }`.
 */
function assertArrayLengthWithinBudget(
  value: unknown[],
  path: string,
  maxLength: number,
): void {
  if (value.length <= maxLength) {
    return;
  }
  throw createBanyanRuntimeError(
    `${path} has ${value.length} items, exceeding the limit of ${maxLength}.`,
    {
      banyanPhase: "generate-output",
      banyanSourcePath: path,
    },
  );
}

function addTextToOutputBudget(
  value: string,
  path: string,
  budget: OutputBudget,
): void {
  if (value.length > MAX_TEXT_UNIT_VALUE_LENGTH) {
    throw createBanyanRuntimeError(
      `${path} has ${value.length} characters, exceeding the per-unit limit of ${MAX_TEXT_UNIT_VALUE_LENGTH}.`,
      {
        banyanPhase: "generate-output",
        banyanSourcePath: path,
      },
    );
  }

  budget.textLength += value.length;
  if (budget.textLength > MAX_OUTPUT_TEXT_LENGTH) {
    throw createBanyanRuntimeError(
      `generate() output text has ${budget.textLength} characters, exceeding the limit of ${MAX_OUTPUT_TEXT_LENGTH}.`,
      {
        banyanPhase: "generate-output",
        banyanSourcePath: path,
      },
    );
  }
}

export function normalizeGenerateResult(
  raw: unknown,
  contexts: CitationContext[],
  styleName: string,
  citationType: Style["INFO"]["citationType"],
): { citations: unknown; bibliography: unknown } {
  if (!raw || typeof raw !== "object") {
    const message =
      raw === undefined
        ? `Style "${styleName}" function generate has no return value. Please return { citations, bibliography }.`
        : `Style "${styleName}" function generate returned invalid value. Expected { citations, bibliography }.`;
    try {
      Zotero.getMainWindow().alert(message);
    } catch {
      /* noop */
    }
    throw createBanyanRuntimeError(message, {
      banyanPhase: "generate-output",
      banyanSourcePath: "generate()",
    });
  }

  const result = raw as Record<string, unknown>;
  const rawCitations = result.citations;
  const rawBibliography = result.bibliography;

  if (!Array.isArray(rawCitations)) {
    const message = `Style "${styleName}" generate().citations is not an array.`;
    throw createBanyanRuntimeError(message, {
      banyanPhase: "generate-output",
      banyanSourcePath: "generate().citations",
    });
  }
  if (!Array.isArray(rawBibliography)) {
    const message = `Style "${styleName}" generate().bibliography is not an array.`;
    throw createBanyanRuntimeError(message, {
      banyanPhase: "generate-output",
      banyanSourcePath: "generate().bibliography",
    });
  }

  assertArrayLengthWithinBudget(
    rawCitations,
    "generate().citations",
    MAX_OUTPUT_ARRAY_LENGTH,
  );
  assertArrayLengthWithinBudget(
    rawBibliography,
    "generate().bibliography",
    MAX_OUTPUT_ARRAY_LENGTH,
  );

  const budget: OutputBudget = { textLength: 0 };
  const contextById = new Map(contexts.map((ctx) => [ctx.id, ctx]));
  const citations = rawCitations.map((citation, index) =>
    normalizeCitation(
      citation,
      contextById,
      citationType,
      `citations[${index}]`,
      budget,
    ),
  );
  const bibliography = rawBibliography.map((line, index) =>
    normalizeBibliographyLine(line, `bibliography[${index}]`, budget),
  );

  return { citations, bibliography };
}

function normalizeCitation(
  input: unknown,
  contextById: Map<string, CitationContext>,
  citationType: Style["INFO"]["citationType"],
  outputPath: string,
  budget: OutputBudget,
): Citation {
  const citation = input as ScriptIntextCitation | ScriptNoteCitation;
  const citationRecord = citation as Record<string, unknown>;
  const id = requireNonEmptyString(citationRecord.id, `${outputPath}.id`);
  const matchedContext = contextById.get(id);
  if (!matchedContext) {
    throw createBanyanRuntimeError(
      `Citation output id "${id}" cannot be matched to input contexts.`,
      {
        banyanPhase: "generate-output",
        banyanSourcePath: `${outputPath}.id`,
      },
    );
  }

  const source: CitationSource = {
    cites: matchedContext.cites,
    params: matchedContext.params,
  };

  const rawCitation = citation as Record<string, unknown>;
  const {
    content: rawContent,
    units: _legacyUnits,
    type: _rawType,
    ...rest
  } = rawCitation;
  const normalized: Citation & { reference?: RichText } = {
    ...(rest as Omit<Citation, "id" | "source" | "content">),
    id,
    type: citationType,
    source,
    content: normalizeRequiredTopLevelUnit(
      rawContent,
      `${outputPath}.content`,
      budget,
    ),
  };
  void _legacyUnits;
  void _rawType;
  if (citationType === "note-citation") {
    normalized.reference = normalizeRequiredTopLevelUnit(
      citationRecord.reference,
      `${outputPath}.reference`,
      budget,
    );
  }
  return normalized;
}

export function normalizeStyleCitationType(
  input: unknown,
  styleName: string,
): Style["INFO"]["citationType"] {
  switch (input) {
    case "intext-citation":
    case "note-citation":
      return input;
    default:
      throw createBanyanRuntimeError(
        `Style "${styleName}" has invalid INFO.citationType. Expected "intext-citation" or "note-citation".`,
        {
          banyanPhase: "style-contract",
          banyanSourcePath: "INFO.citationType",
        },
      );
  }
}

function normalizeBibliographyLine(
  input: unknown,
  outputPath: string,
  budget: OutputBudget,
): BibliographyLine {
  const line = (input ?? {}) as Record<string, unknown>;
  const type = normalizeBibliographyLineType(line.type, `${outputPath}.type`);
  const content = normalizeRequiredTopLevelUnit(
    line.content,
    `${outputPath}.content`,
    budget,
  );

  if (type === "bibliography-title") {
    return {
      type: "bibliography-title",
      content,
    };
  }

  return {
    id: requireNonEmptyString(line.id, `${outputPath}.id`),
    type: "bibliography-entry",
    content,
  };
}

function normalizeBibliographyLineType(
  value: unknown,
  fieldName: string,
): BibliographyLine["type"] {
  switch (value) {
    case "bibliography-title":
    case "bibliography-entry":
      return value;
    default:
      throw createBanyanRuntimeError(
        `${fieldName} must be "bibliography-title" or "bibliography-entry".`,
        {
          banyanPhase: "generate-output",
          banyanSourcePath: fieldName,
        },
      );
  }
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  const out = typeof value === "string" ? value.trim() : "";
  if (!out) {
    throw createBanyanRuntimeError(`${fieldName} must be a non-empty string.`, {
      banyanPhase: "generate-output",
      banyanSourcePath: fieldName,
    });
  }
  return out;
}

function normalizeRequiredTopLevelUnit(
  input: unknown,
  fieldName: string,
  budget: OutputBudget,
): RichText {
  if (input == null) {
    throw createBanyanRuntimeError(`${fieldName} is required.`, {
      banyanPhase: "generate-output",
      banyanSourcePath: fieldName,
    });
  }
  return normalizeTopLevelUnit(input, fieldName, budget);
}

function normalizeTopLevelUnit(
  input: unknown,
  fieldName: string,
  budget: OutputBudget,
): RichText {
  if (Array.isArray(input)) {
    throw createBanyanRuntimeError(
      `${fieldName} must be a single Unit. Use group([...]) or fallback([...]) to combine multiple units.`,
      {
        banyanPhase: "generate-output",
        banyanSourcePath: fieldName,
      },
    );
  }

  const out: RichTextRun[] = [];
  for (const compiled of compileUserUnit(input)) {
    const unit = finalizeInternalTextUnit(compiled);
    addTextToOutputBudget(unit.value, fieldName, budget);
    pushMergedTextRun(out, unit);
  }
  return richTextFromRuns(out);
}

function compileUserUnit(input: unknown): InternalTextUnit[] {
  const unit = normalizeUnitInput(input);
  if (unit == null) {
    return [];
  }
  return compileOutputUnit(unit);
}

function compileOutputUnit(unit: Unit): InternalTextUnit[] {
  if (typeof unit === "string" || typeof unit === "number") {
    return splitTextUnitByMarkup({ value: normalizeTextValue(unit) });
  }
  if (!("type" in unit)) {
    return splitTextUnitByMarkup(unit);
  }

  switch (unit.type) {
    case "group":
      return compileOutputGroup(unit);
    case "affix":
      return compileOutputAffix(unit);
    case "fall":
      return compileOutputFallback(unit);
    case "when":
      return compileOutputWhen(unit);
    case "text-case":
      return compileOutputTextCase(unit);
    case "style":
      return compileOutputStyle(unit);
    case "link":
      return compileOutputLink(unit);
    default:
      return [];
  }
}

function hasVisualText(units: InternalTextUnit[]): boolean {
  return units.length > 0 && units.some((unit) => unit.value !== "");
}

function compileOutputGroup(unit: GroupUnit): InternalTextUnit[] {
  const blocks = unit.units.map(compileOutputUnit).filter(hasVisualText);
  if (blocks.length === 0) {
    return [];
  }

  const out: InternalTextUnit[] = [];
  blocks.forEach((block, index) => {
    if (index > 0 && unit.delimiter) {
      out.push(...compileOutputUnit(unit.delimiter));
    }
    out.push(...block);
  });
  return out;
}

function compileOutputAffix(unit: AffixUnit): InternalTextUnit[] {
  const blocks = compileOutputUnit(unit.unit);
  if (blocks.length === 0) {
    return [];
  }

  const out: InternalTextUnit[] = [];
  if (unit.prefix != undefined) {
    const prefixBlocks = compileOutputUnit(unit.prefix);
    if (hasVisualText(prefixBlocks)) {
      out.push(...prefixBlocks);
    }
  }
  out.push(...blocks);
  if (unit.suffix != undefined) {
    const suffixBlocks = compileOutputUnit(unit.suffix);
    if (hasVisualText(suffixBlocks)) {
      out.push(...suffixBlocks);
    }
  }
  return out;
}

function compileOutputFallback(unit: FallbackUnit): InternalTextUnit[] {
  for (const candidate of unit.units) {
    const result = compileOutputUnit(candidate);
    if (hasVisualText(result)) {
      return result;
    }
  }
  return [];
}

function compileOutputWhen(unit: WhenUnit): InternalTextUnit[] {
  return unit.condition
    ? compileOutputUnit(unit.trueUnit)
    : unit.flseUnit
      ? compileOutputUnit(unit.flseUnit)
      : [];
}

function compileOutputTextCase(unit: TextCaseUnit): InternalTextUnit[] {
  const blocks = compileOutputUnit(unit.unit);
  return applyTextCaseToUnits(blocks, unit.form, unit.ignoreWords);
}

function compileOutputStyle(unit: WithStyleUnit): InternalTextUnit[] {
  return compileOutputUnit(unit.unit).map((textUnit) => ({
    ...textUnit,
    ...unit.style,
  }));
}

function compileOutputLink(unit: LinkUnit): InternalTextUnit[] {
  const link = sanitizeLink(unit.link);
  if (!link) {
    return compileOutputUnit(unit.unit);
  }
  return compileOutputUnit(unit.unit).map((textUnit) => ({
    ...textUnit,
    link,
  }));
}

function splitTextUnitByMarkup(base: TextUnit): InternalTextUnit[] {
  const text = base.value ?? "";
  if (!looksLikeMarkup(text)) {
    return [{ ...base, value: decodeEntities(text) }];
  }

  const { value: _ignoredValue, ...styleBase } = base;
  const out: InternalTextUnit[] = [];

  const root = parseHTMLContainer(text);
  if (!root) {
    return [{ ...base, value: decodeEntities(text) }];
  }

  const walk = (node: Node, style: InternalTextStyle) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue || "";
      if (!value) return;
      const unit: InternalTextUnit = {
        ...(styleBase as InternalTextStyle),
        ...style,
        value,
      };
      pushMergedInternalTextUnit(out, unit);
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === "br") {
      const unit: InternalTextUnit = {
        ...(styleBase as InternalTextStyle),
        ...style,
        value: "\n",
      };
      pushMergedInternalTextUnit(out, unit);
      return;
    }

    const nextStyle = { ...style };
    applyStylePatchFromElement(nextStyle, el);
    for (const child of Array.from(el.childNodes)) {
      if (child) walk(child, nextStyle);
    }
  };

  for (const child of Array.from(root.childNodes)) {
    if (child) walk(child, {});
  }

  if (!out.length) {
    return [{ ...base, value: root.textContent || "" }];
  }
  return out;
}

function looksLikeMarkup(text: string): boolean {
  return /<\/?(?:b|strong|i|em|sup|sub|a|span|br|sc)\b/i.test(text);
}

function applyStylePatchFromElement(
  style: InternalTextStyle,
  el: Element,
): void {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case "b":
    case "strong":
      style.bold = true;
      break;
    case "i":
    case "em":
      style.italic = true;
      break;
    case "sup":
      style.script = "superscript";
      break;
    case "sub":
      style.script = "subscript";
      break;
    case "sc":
      style.smallCaps = true;
      break;
    case "a": {
      const href = (el.getAttribute("href") || "").trim();
      const link = sanitizeLink(href);
      if (link) style.link = link;
      break;
    }
    case "span": {
      const styleText = el.getAttribute("style") || "";
      const classText = el.getAttribute("class") || "";
      const color = extractCssValue(styleText, "color");
      const bg =
        extractCssValue(styleText, "background-color") ||
        extractCssValue(styleText, "background");
      if (color) style.color = color;
      if (bg) style.backgroundColor = bg;
      if (/\bnocase\b/i.test(classText)) style.noCase = true;
      if (isCssValue(styleText, "font-variant", "small-caps")) {
        style.smallCaps = true;
      }
      break;
    }
    default:
      break;
  }
}

function extractCssValue(styleText: string, prop: string): string | undefined {
  const re = new RegExp(`${prop}\\s*:\\s*([^;]+)`, "i");
  const m = styleText.match(re);
  return m ? m[1].trim() : undefined;
}

function isCssValue(styleText: string, prop: string, value: string): boolean {
  return (
    extractCssValue(styleText, prop)
      ?.toLowerCase()
      .split(/\s+/)
      .includes(value) ?? false
  );
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");
}

function pushMergedTextRun(out: RichTextRun[], unit: RichTextRun): void {
  if (!unit.value) return;
  const last = out[out.length - 1];
  if (!last) {
    out.push(unit);
    return;
  }
  if (
    last.bold === unit.bold &&
    last.italic === unit.italic &&
    last.script === unit.script &&
    last.link === unit.link &&
    last.color === unit.color &&
    last.backgroundColor === unit.backgroundColor
  ) {
    last.value += unit.value;
    return;
  }
  out.push(unit);
}

function pushMergedInternalTextUnit(
  out: InternalTextUnit[],
  unit: InternalTextUnit,
): void {
  if (!unit.value) return;
  const last = out[out.length - 1];
  if (!last) {
    out.push(unit);
    return;
  }
  if (
    last.bold === unit.bold &&
    last.italic === unit.italic &&
    last.script === unit.script &&
    last.link === unit.link &&
    last.color === unit.color &&
    last.backgroundColor === unit.backgroundColor &&
    last.smallCaps === unit.smallCaps &&
    last.noCase === unit.noCase
  ) {
    last.value += unit.value;
    return;
  }
  out.push(unit);
}

function applyTextCaseToUnits(
  units: InternalTextUnit[],
  form: TextCaseForm,
  ignoreWords: string[] = [],
): InternalTextUnit[] {
  if (units.length === 0) {
    return [];
  }

  if (form === "small-caps") {
    return units.map((unit) =>
      isCaseProtectedUnit(unit)
        ? unit
        : { ...unit, value: applyTextCase(unit.value, form, ignoreWords) },
    );
  }

  const out: InternalTextUnit[] = [];
  let run: InternalTextUnit[] = [];

  const flushRun = () => {
    if (!run.length) {
      return;
    }
    for (const unit of transformCaseRun(run, form, ignoreWords)) {
      pushMergedInternalTextUnit(out, unit);
    }
    run = [];
  };

  for (const unit of units) {
    if (isCaseProtectedUnit(unit)) {
      flushRun();
      pushMergedInternalTextUnit(out, unit);
      continue;
    }
    run.push(unit);
  }
  flushRun();

  return out;
}

function isCaseProtectedUnit(unit: InternalTextUnit): boolean {
  return unit.noCase === true || unit.smallCaps === true;
}

function transformCaseRun(
  units: InternalTextUnit[],
  form: TextCaseForm,
  ignoreWords: string[],
): InternalTextUnit[] {
  const input = units.map((unit) => unit.value).join("");
  const transformed = applyTextCase(input, form, ignoreWords);

  let offset = 0;
  return units
    .map((unit, index) => {
      const nextOffset =
        index === units.length - 1
          ? transformed.length
          : Math.min(transformed.length, offset + unit.value.length);
      const value = transformed.slice(offset, nextOffset);
      offset = nextOffset;
      return { ...unit, value };
    })
    .filter((unit) => unit.value.length > 0);
}

function finalizeInternalTextUnit(unit: InternalTextUnit): RichTextRun {
  const { smallCaps, noCase: _noCase, value, ...style } = unit;
  return {
    ...style,
    value: smallCaps ? applyTextCase(value, "small-caps") : value,
  };
}

const HTML_ROOT_ID = "__banyan_html_root__";

function parseHTMLContainer(input: string): HTMLElement | null {
  try {
    const DOMParserCtor =
      (ztoolkit.getGlobal("DOMParser") as (new () => DOMParser) | undefined) ||
      (typeof DOMParser === "function" ? DOMParser : undefined);
    if (!DOMParserCtor) return null;
    const parser = new DOMParserCtor();
    const doc = parser.parseFromString(
      `<div id="${HTML_ROOT_ID}">${input}</div>`,
      "text/html",
    );
    return doc.getElementById(HTML_ROOT_ID) as HTMLElement | null;
  } catch {
    return null;
  }
}
