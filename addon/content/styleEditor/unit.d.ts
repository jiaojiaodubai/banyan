type RenderStyle = {
  italic?: boolean;
  bold?: boolean;
  script?: "superscript" | "subscript";
  link?: string;
  color?: string;
  backgroundColor?: string;
};

type TextUnit = RenderStyle & {
  value: string;
};

type PrintableValue = string | number;

type GroupUnit = {
  type: "group";
  units: Unit[];
  delimiter?: Unit;
};

type AffixUnit = {
  type: "affix";
  unit: Unit;
  prefix?: Unit;
  suffix?: Unit;
};

type FallbackUnit = {
  type: "fall";
  units: Unit[];
};

type WhenUnit = {
  type: "when";
  condition: boolean;
  trueUnit: Unit;
  flseUnit?: Unit;
};

type WithStyleUnit = {
  type: "style";
  style: RenderStyle;
  unit: Unit;
};

type TextCaseForm =
  | "lower"
  | "upper"
  | "small-caps"
  | "title"
  | "sentence"
  | "name";

type TextCaseUnit = {
  type: "text-case";
  unit: Unit;
  form: TextCaseForm;
  ignoreWords?: string[];
};

type Unit =
  | TextUnit
  | GroupUnit
  | AffixUnit
  | FallbackUnit
  | WhenUnit
  | TextCaseUnit
  | WithStyleUnit
  | PrintableValue;

type UnitUtils = {
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
};
