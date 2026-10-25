/// <reference path="./style.d.ts" />
/// <reference path="./unit.d.ts" />

/**
 * Language selector for multilingual helpers. Pass a single BCP-47-style tag
 * (e.g. `"en"`, `"zh-CN"`) or an ordered array of preferences. Tags are matched
 * leniently — lowercased with `_` treated as `-`, and canonicalized when the
 * runtime knows them — so script and variant subtags (`ca-ES-valencia`,
 * `en-150`) are accepted here even though the dialog's own validation is
 * stricter. A bare language code also matches its regional variants (and vice
 * versa), e.g. `"zh"` matches `"zh-CN"`.
 */
type MultilingualLanguage = string | readonly string[];

type ExtraValueMode = "string" | "array";
/**
 * Extra-field key/value map. Keys are normalized to kebab-case at item
 * conversion time (e.g. "My Key" / "AuthorID" become "my-key" / "author-id").
 */
type ExtraValueItem = {
  readonly extra?: Readonly<Record<string, string | readonly string[]>>;
};
/**
 * Read a value from `item.extra`. The `key` must be the normalized
 * kebab-case form produced at item conversion time; query-time normalization
 * is not performed.
 */
type GetExtraValue = {
  (item: ExtraValueItem, key: string): string;
  (item: ExtraValueItem, key: string, mode: "string"): string;
  (item: ExtraValueItem, key: string, mode: "array"): string[];
};
type DateParts = {
  /** Four-digit zero-padded year, e.g. `"2024"`. */
  year: string;
  /** Two-digit month (01-12), or `""` when the source has no month. */
  month: string;
  /** Two-digit day (01-31), or `""` when the source has no day. */
  day: string;
};
/**
 * Parse a date and hand its parts to `callback`.
 *
 * The runtime understands `YYYY-MM-DD`/`YYYY.MM.DD`/`YYYY/MM/DD`, `YYYY-MM`,
 * a bare year, day-first slash dates, English month names ("Jan 5, 2024"),
 * and Chinese forms (`2024年1月5日`). A numeric `value` is treated as a UTC
 * timestamp. When parsing succeeds the callback result is returned;
 * otherwise the original input is returned unchanged.
 */
type FormatDate = <T>(
  value: string | number,
  callback: (parts: DateParts) => T,
) => T | string;

/**
 * A delegation/resource failure. It is returned, never thrown: the author's
 * fallback branch should switch on `reason`, while `message` is for people.
 */
type StyleUtilityFailure<R extends string> = {
  ok: false;
  reason: R;
  message: string;
};

/** Why `callStyle()` could not produce a result. */
type CallStyleFailureReason =
  | "unresolved"
  | "undeclared"
  | "cycle"
  | "depth"
  | "timeout"
  | "failed"
  | "citation-type-mismatch"
  | "budget";

/**
 * Result of one `callStyle()`: the called style's normalized output, or a
 * failure the caller is expected to handle.
 *
 * `citations` holds one normalized `RichText` per input context, in the same
 * order; `bibliography` is the called style's own bibliography, ready to pass
 * through. Both are already valid Units.
 */
type CallStyleResult =
  | {
      ok: true;
      citations: RichText[];
      bibliography: BibliographyLine[];
    }
  | StyleUtilityFailure<CallStyleFailureReason>;

/** Why `loadResource()` could not produce data. */
type LoadResourceFailureReason =
  | "undeclared"
  | "unavailable"
  | "missing"
  | "too-large"
  | "invalid"
  | "timeout";

/**
 * Result of one `loadResource()`: the parsed/decoded, deep-frozen data, or a
 * failure the caller is expected to handle.
 */
type LoadResourceResult<T = unknown> =
  { ok: true; data: T } | StyleUtilityFailure<LoadResourceFailureReason>;

/**
 * Additional utilities injected into the style sandbox: the {@link UnitUtils}
 * builders plus the readers and helpers below. The `read*`/multilingual
 * helpers are async and return Promises; everything else is synchronous.
 *
 * The sandbox also provides `console`:
 *
 * - `log` / `debug` / `trace` (also `dir`, `dirxml`, `table`) are tracing
 *   output: a stream that may be dropped, budgeted per run and never kept.
 * - `info` / `warn` / `error` are findings: they are kept on the style instance
 *   (`style.diagnostics`) and reach a host's console. A style that can continue
 *   reports here instead of throwing.
 * - `assert(condition, ...)` reports like `error` when the condition is false.
 * - `count`, `time`, `group`, `clear` and friends exist and do nothing.
 */
type StyleUtils = UnitUtils & {
  // async
  /**
   * Read a file through the host's `readFile` capability as raw bytes.
   * `relPath` is resolved by the host; which directory, what traversal rules
   * and whether a size limit applies are the host's policy
   * (`dev/hostIntegration.md`, capabilities).
   */
  readBytes: (relPath: string, options?: ReadOptions) => Promise<Uint8Array>;
  /**
   * Read a UTF-8 text file through the host's `readFile` capability.
   * The path and size policy are the host's, as for {@link readBytes}.
   */
  readText: (relPath: string, options?: ReadUTF8Options) => Promise<string>;
  /**
   * Read and parse JSON through the host's `readFile` capability.
   * The path and size policy are the host's, as for {@link readBytes}.
   */
  readJSON: <T = unknown>(
    relPath: string,
    options?: ReadUTF8Options,
  ) => Promise<T>;
  /**
   * Resolve every item that is related to `item` through the Banyan
   * "multilingual item" relation. Returns an empty array when the item is
   * not part of any multilingual group. Items come back as the same safe
   * readonly views used by `contexts`.
   */
  getMultilingualItems: <T extends ScriptItem = ScriptItem>(
    item: T,
  ) => Promise<readonly T[]>;
  /**
   * Pick the entry of `item`'s multilingual group that best matches
   * `language` (see {@link MultilingualLanguage}). Selectors are tried in
   * order, and within one selector an exact language tag wins over the
   * bare-code/variant fallback; `item` itself is preferred over its siblings,
   * and the rest is settled by tag then item ID, so the result never depends on
   * relation order. Unmatched requests fall back to the source item. Throws
   * when `language` resolves to an empty list. Returns the same safe readonly
   * views used by `contexts`.
   */
  getMultilingualItem: <T extends ScriptItem = ScriptItem>(
    item: T,
    language: MultilingualLanguage,
  ) => Promise<T>;
  /**
   * Run another style's `generate()` over a batch of citation contexts.
   *
   * Only an id declared in `STYLE_DEPENDENCIES` can be called; anything else
   * returns `undeclared` without touching the host. The called style must have
   * the same `INFO.citationType` as this one, and the call chain may not repeat
   * an id (`cycle`) or grow past the depth limit (`depth`). Every failure is
   * returned as `{ ok: false, reason, message }` and also appears once in
   * `style.diagnostics`; nothing is thrown. A batch result is one `RichText`
   * per context, in input order. Call once with all items instead of once per
   * item.
   *
   * `contexts` are the safe views from `contexts`; `optionValues` are resolved
   * against the called style's own `STYLE_OPTIONS`.
   */
  callStyle: (
    id: string,
    contexts: readonly ScriptContext[],
    optionValues?: Readonly<StyleOptionValues>,
  ) => Promise<CallStyleResult>;
  /**
   * Read a file declared in `STYLE_RESOURCES` by its declaration id.
   *
   * The core validates the declared path, enforces its own byte cap and
   * timeout, parses `json`/decodes `text`, and runs the declaration's
   * `validate()`. Success is cached per style instance and deep-frozen, so the
   * same call returns the same object and a run cannot change another run's
   * table. Every failure is returned as `{ ok: false, reason, message }` and
   * also appears once in `style.diagnostics`; nothing is thrown. `readBytes`,
   * `readText` and `readJSON` remain the lower-level primitives.
   */
  loadResource: <T = unknown>(id: string) => Promise<LoadResourceResult<T>>;
  // sync
  /** Generate a random RFC 4122 version 4 UUID string. */
  uuid: () => string;
  /**
   * Read a value from the parsed `item.extra` map using its normalized
   * kebab-case `key`. Default mode returns the first value as a string
   * (`""` when missing); mode `"array"` returns a string array (`[]` when
   * missing). Keys must already be normalized — see {@link ExtraValueItem}.
   */
  getExtraValue: GetExtraValue;
  /**
   * Parse restricted markup — for example a `format:"rich"` parameter value or
   * markup received from an external source — into one Unit. A structured `RichText` is
   * already a Unit and needs no conversion.
   * Recognized tags are the same ones generate output accepts
   * (`b`/`strong`, `i`/`em`, `sup`, `sub`, `a`, `span`, `br`, `sc`). A value
   * with no recognized tag stays literal text; once one is present, unknown
   * elements are dropped while their text is kept. `nocase` spans and `sc`
   * are resolved into casing at this point, not preserved as markup.
   * Use `unitToHtml` for the other direction.
   */
  htmlToUnit: (html: string) => Unit;
  /**
   * Serialize a Unit to restricted markup, escaping text and filtering link
   * protocols. Intended for debugging, tests, string sinks and external
   * interfaces; normal citation output is already a Unit and does not need it.
   * Round-trips the visual marks `htmlToUnit` can represent; casing that was
   * resolved while parsing (`nocase`, `sc`) comes back as characters.
   */
  unitToHtml: (unit: Unit) => string;
  /**
   * Parse a date and feed its `{ year, month, day }` parts to `callback`,
   * returning the callback result, or the untouched input when the value
   * cannot be parsed. See {@link FormatDate} for accepted formats.
   */
  formatDate: FormatDate;
  /**
   * Wrap a plain object into a readonly view where reading any key returns
   * a string: missing keys and non-string values yield `""`, and writes
   * are silently ignored. Same missing-value semantics as the sandbox data
   * views.
   */
  safeRecord: (object: Record<string, unknown>) => Record<string, string>;
  /** Coerce a value to string: strings/numbers/booleans keep their literal form, everything else becomes `""`. */
  safeString: (value: unknown) => string;
};

/**
 * Options for `readBytes`, mirroring Gecko's `IOUtils.read`. Declared
 * locally so the style-facing typings stay self-contained outside a
 * Zotero/Firefox ambient type environment.
 */
type ReadOptions = ReadUTF8Options & {
  /** Read at most this many bytes (`null` means no limit). */
  maxBytes?: number | null;
  /** Start reading from this byte offset. */
  offset?: number;
};

/**
 * Options for `readText`/`readJSON`, mirroring Gecko's `IOUtils.readUTF8`.
 * Declared locally so the style-facing typings stay self-contained outside
 * a Zotero/Firefox ambient type environment.
 */
type ReadUTF8Options = {
  /** Decompress gzip-compressed file content before reading. */
  decompress?: boolean;
};

declare const readBytes: StyleUtils["readBytes"];
declare const readText: StyleUtils["readText"];
declare const readJSON: StyleUtils["readJSON"];
declare const getMultilingualItems: StyleUtils["getMultilingualItems"];
declare const getMultilingualItem: StyleUtils["getMultilingualItem"];
declare const callStyle: StyleUtils["callStyle"];
declare const loadResource: StyleUtils["loadResource"];
declare const uuid: StyleUtils["uuid"];
declare const getExtraValue: StyleUtils["getExtraValue"];
declare const htmlToUnit: StyleUtils["htmlToUnit"];
declare const unitToHtml: StyleUtils["unitToHtml"];
declare const formatDate: StyleUtils["formatDate"];
declare const safeRecord: StyleUtils["safeRecord"];
declare const safeString: StyleUtils["safeString"];
declare const text: StyleUtils["text"];
declare const plainText: StyleUtils["plainText"];
declare const group: StyleUtils["group"];
declare const affix: StyleUtils["affix"];
declare const fallback: StyleUtils["fallback"];
declare const when: StyleUtils["when"];
declare const textCase: StyleUtils["textCase"];
declare const withStyle: StyleUtils["withStyle"];
declare const link: StyleUtils["link"];
