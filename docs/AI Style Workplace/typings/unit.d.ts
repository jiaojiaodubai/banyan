export type RenderStyle = {
  italic?: boolean;
  bold?: boolean;
  script?: "superscript" | "subscript";
  color?: string;
  backgroundColor?: string;
};

export type TextUnit = RenderStyle & {
  value: string;
};

export type PrintableValue = string | number;

export type GroupUnit = {
  type: "group";
  units: Unit[];
  delimiter?: Unit;
};

export type AffixUnit = {
  type: "affix";
  unit: Unit;
  prefix?: Unit;
  suffix?: Unit;
};

export type FallbackUnit = {
  type: "fall";
  units: Unit[];
};

export type WhenUnit = {
  type: "when";
  condition: boolean;
  trueUnit: Unit;
  flseUnit?: Unit;
};

export type WithStyleUnit = {
  type: "style";
  style: RenderStyle;
  unit: Unit;
};

export type LinkUnit = {
  type: "link";
  link: string;
  unit: Unit;
};

export type TextCaseForm =
  "lower" | "upper" | "small-caps" | "title" | "sentence" | "name";

export type TextCaseUnit = {
  type: "text-case";
  unit: Unit;
  form: TextCaseForm;
  ignoreWords?: string[];
};

export type Unit =
  | TextUnit
  | GroupUnit
  | AffixUnit
  | FallbackUnit
  | WhenUnit
  | TextCaseUnit
  | WithStyleUnit
  | LinkUnit
  | PrintableValue;

export type TextRange = {
  /** Inclusive JS string offset in UTF-16 code units. */
  start: number;
  /** Exclusive JS string offset in UTF-16 code units. */
  end: number;
};

export type InlineMark =
  | (TextRange & { type: "bold"; value: boolean })
  | (TextRange & { type: "italic"; value: boolean })
  | (TextRange & { type: "script"; value: "superscript" | "subscript" })
  | (TextRange & { type: "color"; value: string })
  | (TextRange & { type: "backgroundColor"; value: string })
  | (TextRange & { type: "link"; value: string });

export type RichText = {
  /** Plain text content for the full rendered unit. */
  text: string;
  /** Visual and interactive ranges over `text`. */
  marks: InlineMark[];
};

export type UnitUtils = {
  text: (value: PrintableValue, style?: RenderStyle) => TextUnit;
  plainText: (input: Unit | readonly Unit[]) => string;
  group: (units: Unit[], delimiter?: Unit) => GroupUnit;
  affix: (unit: Unit, prefix?: Unit, suffix?: Unit) => AffixUnit;
  fallback: (units: Unit[]) => FallbackUnit;
  when: (condition: boolean, trueUnit: Unit, flseUnit?: Unit) => WhenUnit;
  textCase: (
    unit: Unit,
    form: TextCaseForm,
    ignoreWords?: string[],
  ) => TextCaseUnit;
  withStyle: (unit: Unit, style: RenderStyle) => WithStyleUnit;
  link: (unit: Unit, link: string) => LinkUnit;
};
