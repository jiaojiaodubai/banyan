/// <reference path="./style.d.ts" />
/// <reference path="./unit.d.ts" />

/**
 * Language selector for multilingual helpers. Pass a single BCP-47-style tag
 * (e.g. `"en"`, `"zh-CN"`) or an ordered array of preferences. Tags are
 * matched case-insensitively with `_` treated as `-`; a bare language code
 * also matches its regional variants (and vice versa), e.g. `"zh"` matches
 * `"zh-CN"`.
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
 * Additional utilities injected into the style sandbox besides the
 * {@link UnitUtils} builders. The `read*`/multilingual helpers are async
 * and return Promises; everything else is synchronous.
 */
type StyleUtils = UnitUtils & {
  // async
  /**
   * Read a file inside the Zotero data directory's `banyan` folder as raw
   * bytes. `relPath` is relative to that folder; absolute paths and `..`
   * traversal are rejected. No hard size limit is enforced.
   */
  readBytes: (relPath: string, options?: ReadOptions) => Promise<Uint8Array>;
  /**
   * Read a UTF-8 text file inside the data directory's `banyan` folder.
   * `relPath` is relative to that folder; absolute paths and `..`
   * traversal are rejected. No hard size limit is enforced.
   */
  readText: (relPath: string, options?: ReadUTF8Options) => Promise<string>;
  /**
   * Read and parse a JSON file inside the data directory's `banyan` folder.
   * `relPath` is relative to that folder; absolute paths and `..`
   * traversal are rejected. No hard size limit is enforced.
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
   * Pick the multilingual sibling of `item` that best matches `language`
   * (see {@link MultilingualLanguage}). The current item itself is returned
   * when its own language matches first, and unmatched requests fall back
   * to the source item. Throws when `language` resolves to an empty list.
   * Returns the same safe readonly views used by `contexts`.
   */
  getMultilingualItem: <T extends ScriptItem = ScriptItem>(
    item: T,
    language: MultilingualLanguage,
  ) => Promise<T>;
  // sync
  /**
   * Print values to the Zotero console while a style runs. Objects are
   * JSON-serialized and long output is truncated. Returns the formatted
   * message that was logged.
   */
  debug: (...values: unknown[]) => string;
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
declare const debug: StyleUtils["debug"];
declare const uuid: StyleUtils["uuid"];
declare const getExtraValue: StyleUtils["getExtraValue"];
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
