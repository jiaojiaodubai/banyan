/// <reference path="./style.d.ts" />
/// <reference path="./unit.d.ts" />

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
  year: string;
  month: string;
  day: string;
};
type FormatDate = <T>(
  value: string | number,
  callback: (parts: DateParts) => T,
) => T | string;

type StyleUtils = UnitUtils & {
  // async
  readBytes: (relPath: string, options?: ReadOptions) => Promise<Uint8Array>;
  readText: (relPath: string, options?: ReadUTF8Options) => Promise<string>;
  readJSON: <T = unknown>(
    relPath: string,
    options?: ReadUTF8Options,
  ) => Promise<T>;
  getMultilingualItems: <T extends ScriptItem = ScriptItem>(
    item: T,
  ) => Promise<readonly T[]>;
  getMultilingualItem: <T extends ScriptItem = ScriptItem>(
    item: T,
    language: MultilingualLanguage,
  ) => Promise<T>;
  // sync
  debug: (...values: unknown[]) => string;
  uuid: () => string;
  getExtraValue: GetExtraValue;
  formatDate: FormatDate;
  safeRecord: (object: Record<string, unknown>) => Record<string, string>;
  safeString: (value: unknown) => string;
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
