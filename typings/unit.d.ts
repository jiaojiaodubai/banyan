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

/**
 * Declarative unit builders injected into the style sandbox as globals.
 *
 * Compose output declaratively instead of formatting strings by hand: the
 * host compiles any Unit into `RichText { text, marks }` and derives every
 * mark range itself, so never hand-write `RichText`/mark offsets. A bare
 * `string` or finite `number` is also accepted wherever a Unit is expected.
 *
 * A unit is *empty* when it compiles to no visible text (e.g. `""`, a
 * missing safe-view field, or a combination whose parts are all empty).
 * `group`, `affix` and `fallback` handle empties for you and never leak
 * stray delimiters or affixes; whitespace such as `" "` is not empty.
 */
export type UnitUtils = {
  /** Build a leaf from a plain value (`string`, or a finite `number`), optionally with `style`. */
  text: (value: PrintableValue, style?: RenderStyle) => TextUnit;
  /**
   * Compile a unit (or a list of units) and return its final visible text
   * as a plain string — structure, affixes and casing resolved, empty
   * parts dropped.
   */
  plainText: (input: Unit | readonly Unit[]) => string;
  /**
   * Concatenate `units` into one flow. Empty segments are skipped and
   * `delimiter` is emitted only between two actually-rendered segments; an
   * all-empty group renders nothing.
   */
  group: (units: Unit[], delimiter?: Unit) => GroupUnit;
  /**
   * Attach `prefix`/`suffix` around `unit`. If `unit` itself is empty the
   * whole affix renders nothing (no stray prefix/suffix); an empty
   * prefix/suffix also renders nothing.
   */
  affix: (unit: Unit, prefix?: Unit, suffix?: Unit) => AffixUnit;
  /**
   * Render the first candidate that produces visible text and ignore the
   * rest. Candidates that are `null`/`undefined`/`false` or that compile
   * to no text are skipped, so prefer it over `a || b` when picking among
   * optional pieces of content.
   */
  fallback: (units: Unit[]) => FallbackUnit;
  /** Render `trueUnit` when `condition` holds; otherwise render `flseUnit` if given, else nothing. */
  when: (condition: boolean, trueUnit: Unit, flseUnit?: Unit) => WhenUnit;
  /**
   * Reformat the rendered text of `unit` into `form` (`lower`/`upper`/
   * `small-caps`/`title`/`sentence`/`name`). Words in `ignoreWords` are
   * left untouched where the form is case-aware.
   */
  textCase: (
    unit: Unit,
    form: TextCaseForm,
    ignoreWords?: string[],
  ) => TextCaseUnit;
  /** Apply `style` over `unit`; it merges with any style `unit` already carries. */
  withStyle: (unit: Unit, style: RenderStyle) => WithStyleUnit;
  /**
   * Make `unit` a single hyperlink to `link`. Supported schemes:
   * `https://`, `http://`, `doi:` and `banyan://entry/<id>`. Links are
   * expressed here, not inside `RenderStyle`.
   */
  link: (unit: Unit, link: string) => LinkUnit;
};
