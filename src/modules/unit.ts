import {
  AffixUnit,
  WhenUnit as WhenUnit,
  FallbackUnit,
  GroupUnit,
  PrintableValue,
  RenderStyle,
  TextCaseForm,
  TextCaseUnit,
  TextUnit,
  Unit,
  UnitUtils,
  WithStyleUnit,
} from "../../typings/unit";

export function normalizeTextValue(value: unknown): string {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  return typeof value === "string" ? value : "";
}

function toUnit(value: PrintableValue, style?: RenderStyle): TextUnit {
  return {
    value: normalizeTextValue(value),
    ...style,
  };
}

export function plainText(input: Unit | readonly Unit[]): string {
  const units = Array.isArray(input) ? input : [input];
  return units
    .flatMap((unit) => compile(unit))
    .map((unit) => unit.value)
    .join("");
}

export const unitUtils = {
  text: toUnit,
  plainText,
  group: (units: Unit[], delimiter?: Unit): GroupUnit => {
    return { type: "group", units, delimiter };
  },
  affix: (unit: Unit, prefix?: Unit, suffix?: Unit): AffixUnit => {
    return {
      type: "affix",
      unit,
      prefix,
      suffix,
    };
  },
  fallback: (units: Unit[]): FallbackUnit => {
    return { type: "fall", units };
  },
  when: (condition: boolean, trueUnit: Unit, flseUnit?: Unit): WhenUnit => {
    return { type: "when", condition, trueUnit, flseUnit };
  },
  textCase: (
    unit: Unit,
    form: TextCaseForm,
    ignoreWords?: string[],
  ): TextCaseUnit => {
    return { type: "text-case", unit, form, ignoreWords };
  },
  withStyle: (unit: Unit, style: RenderStyle): WithStyleUnit => {
    return { type: "style", unit, style };
  },
} satisfies UnitUtils;

function hasVisualText(units: TextUnit[]): boolean {
  return units.length > 0 && units.some((u) => u.value !== "");
}

export function compile(unit: Unit): TextUnit[] {
  if (typeof unit === "string") {
    return [toUnit(unit)];
  }
  if (typeof unit === "number") {
    return Number.isFinite(unit) ? [toUnit(unit)] : [];
  }
  if (!("type" in unit)) {
    return [unit];
  }
  switch (unit.type) {
    case "group":
      return compileGroup(unit);
    case "affix":
      return compileAffix(unit);
    case "fall":
      return compileFall(unit);
    case "when":
      return compileWhen(unit);
    case "text-case":
      return compileTextCase(unit);
    case "style":
      return compileStyle(unit);
    default:
      return [];
  }
}

function compileGroup(unit: GroupUnit): TextUnit[] {
  const { units, delimiter } = unit;
  const blocks = units.map(compile).filter(hasVisualText);
  if (blocks.length === 0) {
    return [];
  }
  const result: TextUnit[] = [];
  blocks.forEach((block, index) => {
    if (index > 0 && delimiter) {
      result.push(...compile(delimiter));
    }
    result.push(...block);
  });
  return result;
}

function compileAffix(unit: AffixUnit): TextUnit[] {
  const { unit: mainUnit, prefix, suffix } = unit;
  const blocks = compile(mainUnit);
  if (blocks.length === 0) {
    return [];
  }
  const result: TextUnit[] = [];
  if (prefix != undefined) {
    const prefixBlocks = compile(prefix);
    if (hasVisualText(prefixBlocks)) {
      result.push(...prefixBlocks);
    }
  }
  result.push(...blocks);
  if (suffix != undefined) {
    const suffixBlocks = compile(suffix);
    if (hasVisualText(suffixBlocks)) {
      result.push(...suffixBlocks);
    }
  }
  return result;
}

function compileFall(unit: FallbackUnit): TextUnit[] {
  const { units } = unit;
  for (const unit of units) {
    const result = compile(unit);
    if (hasVisualText(result)) {
      return result;
    }
  }
  return [];
}

function compileWhen(unit: WhenUnit): TextUnit[] {
  const { condition, trueUnit, flseUnit } = unit;
  return condition ? compile(trueUnit) : flseUnit ? compile(flseUnit) : [];
}

function compileTextCase(unit: TextCaseUnit): TextUnit[] {
  const { unit: innerUnit, form, ignoreWords } = unit;
  const blocks = compile(innerUnit);
  return applyTextCaseToUnits(blocks, form, ignoreWords);
}

function applyTextCaseToUnits(
  units: TextUnit[],
  form: TextCaseForm,
  ignoreWords: string[] = [],
): TextUnit[] {
  if (units.length === 0) {
    return [];
  }

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
      return {
        ...unit,
        value,
      };
    })
    .filter((unit) => unit.value.length > 0);
}

function applyTextCase(
  str: string,
  form: TextCaseForm,
  ignoreWords: string[] = [],
): string {
  const input = String(str ?? "");
  switch (form) {
    case "lower":
      return input.toLowerCase();
    case "upper":
      return input.toUpperCase();
    case "small-caps":
      return smallCapsCase(input, ignoreWords);
    case "title":
      return titleCase(input, ignoreWords);
    case "sentence":
      return sentenceCase(input, ignoreWords);
    case "name":
      return Zotero.Utilities.capitalizeName(input);
    default:
      return input;
  }
}

function smallCapsCase(str: string, ignoreWords: string[] = []): string {
  const input = String(str ?? "");
  if (!input) return input;

  const cased = input
    .toUpperCase()
    .replace(/[a-zA-Z]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) + 0x1d00),
    );
  return applyIgnoreWords(cased, ignoreWords);
}

function titleCase(str: string, ignoreWords: string[] = []): string {
  const input = String(str ?? "");
  if (!input) return input;

  const cased = Zotero.Utilities.capitalizeTitle(input, true);
  return applyIgnoreWords(cased, ignoreWords);
}

function sentenceCase(str: string, ignoreWords: string[] = []): string {
  const input = String(str ?? "");
  if (!input) return input;

  const cased = Zotero.Utilities.sentenceCase(input);
  return applyIgnoreWords(cased, ignoreWords);
}

function applyIgnoreWords(text: string, ignoreWords: string[]): string {
  if (!ignoreWords.length) return text;

  let output = text;
  for (const word of ignoreWords) {
    const key = word.trim();
    if (!key) continue;
    const re = new RegExp(`\\b${escapeRegExp(key)}\\b`, "giu");
    output = output.replace(re, word);
  }
  return output;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileStyle(unit: WithStyleUnit): TextUnit[] {
  const { unit: mainUnit, style } = unit;
  const result = compile(mainUnit);
  return result.map((u) => ({ ...u, ...style }));
}
