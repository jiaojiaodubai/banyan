/// <reference path="./item.d.ts" />
/// <reference path="./unit.d.ts" />

type CitationType = "intext-citation" | "note-citation";
type MaybePromise<T> = T | Promise<T>;

type ScriptSafeObject<T extends object> = {
  readonly [
    K in keyof T as ScriptSafe<T[K]> extends never ? never : K
  ]-?: ScriptSafe<T[K]>;
};

/**
 * Readonly, "safe" structural view of a host value handed to style scripts.
 *
 * Every object is recursively made `readonly`; functions are kept callable.
 * At runtime the sandbox wraps these views with a proxy so that reading a
 * missing property returns the empty string `""` instead of `undefined`
 * (arrays keep their native indexing and method behavior). Scripts should
 * therefore never assume `undefined` from a missing key — always test
 * against `""` when a value may be absent.
 */
type ScriptSafe<T> = T extends undefined
  ? never
  : T extends (...args: unknown[]) => unknown
    ? T
    : T extends string
      ? string
      : T extends number
        ? number
        : T extends boolean
          ? boolean
          : T extends readonly (infer U)[]
            ? readonly ScriptSafe<U>[]
            : T extends (infer U)[]
              ? readonly ScriptSafe<U>[]
              : T extends object
                ? ScriptSafeObject<T>
                : T;

/**
 * Host-side normalized style API.
 * Callers pass contexts here; the sandbox wrapper injects them as global `contexts`.
 */
interface Style<T extends CitationType = CitationType> {
  INFO: StyleInfo<T>;
  /** Document-wide parameters; values are written to `options`. */
  STYLE_OPTIONS?: StyleOptionParam[];
  /** Parameters for the whole citation; values are written to `CitationContext.params`. */
  CITATION_PARAMS?: CitationParam[];
  /** Parameters for one cited item; values are written to `Cite.params`. */
  CITE_PARAMS?: CiteParam[];
  /** Declared marks for the item context menu (write item field / `extra`). */
  ITEM_FIELD_PRESETS?: FieldPreset[];
  /** Item-type keyed, read-only field checks shown in the item menu. */
  ITEM_FIELD_VALIDATORS?: ItemFieldValidators;
  /** Other styles this one may call through `callStyle()`, by style id. */
  STYLE_DEPENDENCIES?: string[];
  /** Assets under the style's `assets/` directory this one may read through `loadResource()`. */
  STYLE_RESOURCES?: StyleResource[];
  generate: (
    contexts: CitationContext[],
    options?: StyleOptionValues,
  ) => MaybePromise<StyleResult<T>>;
}

/**
 * One file a style may read through `loadResource()`.
 *
 * `id` is the asset's public name *and* its file name: the file lives at
 * `<style directory>/assets/<id>`, with no extension. Lowercase letters,
 * digits and single hyphens only. `format` decides whether the bytes are
 * parsed as JSON or decoded as UTF-8 text. Assets are shared, publicly
 * maintained data; the runtime does not run a per-style validator.
 */
type StyleResource = {
  /** Unique within the style; also the file name under `assets/`. */
  id: string;
  format: "json" | "text";
};

/**
 * User-authored script contract executed inside the sandbox.
 * `generate()` reads the readonly globals `contexts` and `options` instead of
 * accepting arguments.
 */
interface StyleScript<T extends CitationType = CitationType> {
  INFO: StyleInfo<T>;
  STYLE_OPTIONS?: StyleOptionParam[];
  /** Parameters for the whole citation; values are written to `CitationContext.params`. */
  CITATION_PARAMS?: CitationParam[];
  /** Parameters for one cited item; values are written to `Cite.params`. */
  CITE_PARAMS?: CiteParam[];
  ITEM_FIELD_PRESETS?: FieldPreset[];
  ITEM_FIELD_VALIDATORS?: ItemFieldValidators;
  /** Other styles this one may call through `callStyle()`, by style id. */
  STYLE_DEPENDENCIES?: string[];
  /** Assets under the style's `assets/` directory this one may read through `loadResource()`. */
  STYLE_RESOURCES?: StyleResource[];
  generate: () => MaybePromise<ScriptResult<T>>;
}

type StyleInfo<T extends CitationType = CitationType> = {
  id: string;
  title: string;
  description: string;
  citationType: T;
  creator: {
    type: string;
    name: string;
    email?: string;
    uri?: string;
  }[];
  tags: string[];
  documentation: string[];
  license: string;
  updated: string;
  [key: string]: unknown;
};

/**
 * Result of a parameter validator: `true` when the value is usable, `false` or
 * an error message when it is not. The core runs validators while resolving a
 * free parameter and reports the outcome through `ParamState.validation`
 * (`fieldValidation` for list rows). Validators are synchronous, like the other
 * resolution callbacks; they cannot await async utilities.
 */
type ParamCheckResult = boolean | string;
type ParamPreset = string | { label: string; value: string };

type StateValue = string | boolean;
type StyleOptionValue = StateValue;
type StyleOptionValues = Record<string, StyleOptionValue>;

/**
 * The value a parameter can force. A resolver returns `null` when the
 * parameter is free; any other returned value must match the parameter's kind.
 * A throw or an invalid value leaves the parameter free.
 */
type ForcedValue<T, Scope extends unknown[]> =
  T | ((...scope: Scope) => T | null);

type ValueParamBase = {
  id: string;
  label: string;
  description?: string;
  defaultValue?: string;
  /** Suggested values; a string is shorthand for `{ label, value }`. */
  presets?: readonly ParamPreset[];
  /** `rich` values are restricted markup strings, not structured rich text. */
  format?: "plain" | "rich";
};

type StateParamBase = {
  id: string;
  label: string;
  description?: string;
  kind: "state";
  /**
   * Stable state key -> plain-text label. Omit for a boolean toggle.
   * Declaration order is display order.
   */
  states?: Record<string, string>;
  defaultValue?: StateValue;
};

type StyleStateParam = StateParamBase & {
  forcedValue?: ForcedValue<StateValue, [values: Readonly<StyleOptionValues>]>;
};

type StyleValueParam = ValueParamBase & {
  kind: "value";
  forcedValue?: ForcedValue<string, [values: Readonly<StyleOptionValues>]>;
  /**
   * Called by the core while resolving a free option. Return `true` when the
   * value is usable, or `false`/a message when it is not. Hidden and forced
   * options are never validated.
   */
  validate?: (
    value: string,
    values: Readonly<StyleOptionValues>,
  ) => ParamCheckResult;
};

/** Document-wide parameter (`STYLE_OPTIONS`). */
type StyleOptionParam = StyleStateParam | StyleValueParam;

type CitationParamBase = {
  id: string;
  label: string;
  description?: string;
  /** `false` hides the parameter; only a strict `false` is negative. */
  applicable?: (
    citation: Readonly<CitationContext>,
    options: Readonly<StyleOptionValues>,
  ) => boolean;
};

type CitationStateParam = CitationParamBase &
  StateParamBase & {
    forcedValue?: ForcedValue<
      StateValue,
      [
        citation: Readonly<CitationContext>,
        options: Readonly<StyleOptionValues>,
      ]
    >;
  };

type CitationValueParam = CitationParamBase &
  ValueParamBase & {
    kind: "value";
    forcedValue?: ForcedValue<
      string,
      [
        citation: Readonly<CitationContext>,
        options: Readonly<StyleOptionValues>,
      ]
    >;
    /** Called by the core for free values; never for hidden or forced ones. */
    validate?: (
      value: string,
      citation: Readonly<CitationContext>,
      options: Readonly<StyleOptionValues>,
    ) => ParamCheckResult;
  };

/** Parameter for the whole citation (`CITATION_PARAMS`). */
type CitationParam = CitationStateParam | CitationValueParam;

type CiteParamBase = {
  id: string;
  label: string;
  description?: string;
  /** `false` hides the parameter; only a strict `false` is negative. */
  applicable?: (
    cite: Readonly<Cite>,
    citation: Readonly<CitationContext>,
    options: Readonly<StyleOptionValues>,
  ) => boolean;
};

type CiteStateParam = CiteParamBase &
  StateParamBase & {
    forcedValue?: ForcedValue<
      StateValue,
      [
        cite: Readonly<Cite>,
        citation: Readonly<CitationContext>,
        options: Readonly<StyleOptionValues>,
      ]
    >;
  };

type CiteValueParam = CiteParamBase &
  ValueParamBase & {
    kind: "value";
    forcedValue?: ForcedValue<
      string,
      [
        cite: Readonly<Cite>,
        citation: Readonly<CitationContext>,
        options: Readonly<StyleOptionValues>,
      ]
    >;
    /** Called by the core for free values; never for hidden or forced ones. */
    validate?: (
      value: string,
      cite: Readonly<Cite>,
      citation: Readonly<CitationContext>,
      options: Readonly<StyleOptionValues>,
    ) => ParamCheckResult;
  };

/** A repeatable row's field; rows contain only value parameters. */
type ListFieldParam = {
  id: string;
  kind: "value";
  label: string;
  description?: string;
  defaultValue?: string;
  presets?: readonly ParamPreset[];
  format?: "plain" | "rich";
  /** Called by the core once per row while resolving a free list. */
  validate?: (
    value: string,
    row: ListRow,
    cite: Readonly<Cite>,
    citation: Readonly<CitationContext>,
    options: Readonly<StyleOptionValues>,
  ) => ParamCheckResult;
};

type CiteListParam = CiteParamBase & {
  kind: "list";
  fields: readonly ListFieldParam[];
  /** Editor bounds, in rows; the core reports but never truncates a list. */
  min?: number;
  /** Editor bounds, in rows; the core reports but never truncates a list. */
  max?: number;
  defaultValue?: readonly ListRow[];
  forcedValue?: ForcedValue<
    readonly ListRow[],
    [
      cite: Readonly<Cite>,
      citation: Readonly<CitationContext>,
      options: Readonly<StyleOptionValues>,
    ]
  >;
};

/** Parameter for one cited item (`CITE_PARAMS`). */
type CiteParam = CiteStateParam | CiteValueParam | CiteListParam;

/** Host-side aggregate of the three parameter scopes. */
type ParamDeclarations = {
  style: StyleOptionParam[];
  citation: CitationParam[];
  cite: CiteParam[];
};

/** Same sandbox evaluation contract as the parameter callbacks: only a strict `true` is visible. */
type FieldPresetVisible = (item: Readonly<Item>) => boolean;

/**
 * A style-declared shortcut shown in the item context menu ("Quick Marks").
 * Applying it writes each `fields` entry onto the selected items: a real item
 * field when the key is valid for the item type, otherwise an `extra` line.
 */
type FieldPreset = {
  /** Unique within the style; used for logs and menu keys. */
  id: string;
  /** Menu text shown to users; a single string, since styles have no locale concept. */
  label: string;
  /** Limits the menu entry (and the write target) to matching items. */
  visible?: FieldPresetVisible;
  /**
   * Field name (or extra key) to target value. `null` leaves the value to the
   * user and makes the menu label end with an ellipsis.
   */
  fields: Record<string, string | null>;
};

/** Result of one field check. */
type FieldCheckResult = boolean | string | readonly string[];

/**
 * Read one item snapshot and answer whether its fields are usable. The check
 * is read-only and may return a promise; the host awaits it with a timeout.
 * Any other result is reported as a broken checker.
 */
type FieldCheck = (item: Readonly<Item>) => MaybePromise<FieldCheckResult>;

/** One declared check shown in the field-check report. */
type FieldValidator = {
  /** Report label; a single string, since styles have no locale concept. */
  description: string;
  /** Read-only check; an async check is bounded by the host's timeout. */
  check: FieldCheck;
};

/** Field validators grouped by Zotero item type. */
type ItemFieldValidators = Partial<Record<ItemType, readonly FieldValidator[]>>;

type CitationContext = CitationSource & {
  id: string;
  page: number;
};

/** One value a parameter can hold: a state, plain/rich string, or row set. */
type ParamValue = StateValue | string | readonly ListRow[];

/** A repeatable row: field id -> that field's string value (never nested). */
type ListRow = Readonly<Record<string, string>>;

type CitationSource = {
  cites: Cite[];
  params: CitationParams;
};

type CitationParams = Record<string, ParamValue>;

type Cite = {
  item: Item;
  params?: Record<string, ParamValue>;
};

/**
 * Item view exposed to scripts (e.g. `cite.item` inside `contexts`): a
 * readonly {@link ScriptSafe} view of the normalized Banyan item. Known
 * schema fields keep their declared types; keys not covered by the schema
 * stay readable and type as `any`. Absent fields read as `""` at runtime,
 * never `undefined`. `extra` is an already-parsed key/value object — read
 * values with `getExtraValue(item, key)`.
 */
type ScriptItem = ScriptSafe<Item> & {
  readonly [field: string]: any;
};

type ScriptCreator<T extends CreatorType = CreatorType> = ScriptSafe<
  Creator<T>
>;

/** Safe readonly view exposed to style scripts via the global `contexts`. */
type ScriptCitationParams = ScriptSafe<CitationParams>;

type ScriptCite = ScriptSafe<Cite>;

type ScriptCitationSource = ScriptSafe<CitationSource>;

type ScriptContext = ScriptSafe<CitationContext>;

/**
 * The readonly global `contexts` that the sandbox injects before
 * `generate()` runs. Each element is a safe view of one citation context;
 * missing object properties read as `""` while array indexing/methods stay
 * native. `contexts.length` always equals the number of citations to emit.
 */
type ScriptContexts = readonly ScriptContext[];

/**
 * The readonly global `options` injected before `generate()` runs: the
 * effective style-option values. Missing keys read as `""`, like the other
 * sandbox views.
 */
type ScriptOptions = ScriptSafe<StyleOptionValues>;

type ScriptResult<T extends CitationType = CitationType> = {
  citations: ScriptCitationsMap[T];
  bibliography: ScriptBibliographyLine[];
};

type StyleResult<T extends CitationType = CitationType> = {
  citations: CitationsMap[T];
  bibliography: BibliographyLine[];
};

type CitationsMap = {
  "intext-citation": IntextCitation[];
  "note-citation": NoteCitation[];
};

type ScriptCitationsMap = {
  "intext-citation": ScriptIntextCitation[];
  "note-citation": ScriptNoteCitation[];
};

type Citation<T extends CitationType = CitationType> = {
  id: string;
  type: T;
  source: CitationSource;
  content: RichText;
};

type IntextCitation = Citation<"intext-citation">;

// For note citations, inherited content is rendered in the footnote area,
// while reference is the inline marker inserted into the document body.
type NoteCitation = Citation<"note-citation"> & {
  reference: RichText;
};

type BibliographyTitle = {
  id: string;
  type: "bibliography-title";
  content: RichText;
};

type BibliographyEntry = {
  id: string;
  type: "bibliography-entry";
  content: RichText;
};

type BibliographyLine = BibliographyTitle | BibliographyEntry;

type ScriptCitation = {
  id: string;
  // Script authors provide one declarative Unit; the host normalizes it to
  // RichText for rendering.
  content: Unit;
};

type ScriptIntextCitation = ScriptCitation;

// For note citations, inherited content is rendered in the footnote area,
// while reference is the inline marker inserted into the document body.
type ScriptNoteCitation = ScriptCitation & {
  reference: Unit;
};

type ScriptBibliographyTitle = {
  id: string;
  // JS object literal inference widens string properties; keep script-side
  // types permissive and rely on runtime validation for exact tag checking.
  type: "bibliography-title" | string;
  content: Unit;
};

type ScriptBibliographyEntry = {
  id: string;
  type: "bibliography-entry" | string;
  content: Unit;
};

type ScriptBibliographyLine = ScriptBibliographyTitle | ScriptBibliographyEntry;

/**
 * `contexts` is injected as a readonly global by the sandbox before
 * `generate()` is called. Missing object properties fall back to empty
 * strings at runtime, while array semantics stay unchanged.
 */
declare const contexts: ScriptContexts;

/**
 * `options` is injected as a readonly global by the sandbox before
 * `generate()` is called. It carries the effective document-wide parameter
 * values: declared defaults filled in, hidden values replaced, and forced
 * values applied.
 */
declare const options: StyleOptionValues;
