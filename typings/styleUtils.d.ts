import type { UnitUtils } from "./unit";

export type MultilingualLanguage = string | readonly string[];
export type ExtraValueMode = "string" | "array";
/**
 * Extra-field key/value map. Keys are normalized to kebab-case at item
 * conversion time (e.g. "My Key" / "AuthorID" become "my-key" / "author-id").
 */
export type ExtraValueItem = {
  readonly extra?: Readonly<Record<string, string | readonly string[]>>;
};
/**
 * Read a value from `item.extra`. The `key` must be the normalized
 * kebab-case form produced at item conversion time; query-time normalization
 * is not performed.
 */
export type GetExtraValue = {
  (item: ExtraValueItem, key: string): string;
  (item: ExtraValueItem, key: string, mode: "string"): string;
  (item: ExtraValueItem, key: string, mode: "array"): string[];
};
export type DateParts = {
  year: string;
  month: string;
  day: string;
};
export type FormatDate = <T>(
  value: string | number,
  callback: (parts: DateParts) => T,
) => T | string;

export type StyleUtils = UnitUtils & {
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
