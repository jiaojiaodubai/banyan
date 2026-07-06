import type { ScriptItem } from "./style";
import type { UnitUtils } from "./unit";

export type MultilingualLanguage = string | readonly string[];
export type ExtraValueMode = "string" | "array";
export type ExtraValueItem = {
  readonly extra?: Readonly<Record<string, string | readonly string[]>>;
};
export type GetExtraValue = {
  (item: ExtraValueItem, key: string): string;
  (item: ExtraValueItem, key: string, mode: "string"): string;
  (item: ExtraValueItem, key: string, mode: "array"): string[];
};

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
  safeRecord: (object: Record<string, unknown>) => Record<string, string>;
  safeString: (value: unknown) => string;
};
