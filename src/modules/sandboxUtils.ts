// Runtime utilities exposed to user style scripts and helper functions shared
// by the sandbox host bridge.
import type { ScriptItem } from "../../typings/style";
import type { StyleUtils } from "../../typings/styleUtils";
import type {
  AffixUnit,
  FallbackUnit,
  GroupUnit,
  LinkUnit,
  PrintableValue,
  RenderStyle,
  WithStyleUnit,
  TextCaseForm,
  TextCaseUnit,
  TextUnit,
  Unit,
  WhenUnit,
} from "../../typings/unit";
import { normalizeTextValue, plainText as plainUnitText } from "./unit";
import { getMultilingualItems as getRelatedMultilingualItems } from "./relations";
import { isBanyanItem, toBanyanItem } from "../utils/item";
import { sanitizeLink } from "../utils/html";

type IsAsync<T> = T extends (...args: never[]) => Promise<unknown>
  ? true
  : false;
type IsSync<T> = T extends (...args: never[]) => Promise<unknown>
  ? false
  : true;
type AsyncKeys<T> = {
  [K in keyof T]: IsAsync<T[K]> extends true ? K : never;
}[keyof T];
type SyncKeys<T> = {
  [K in keyof T]: IsSync<T[K]> extends true ? K : never;
}[keyof T];
type AsyncStyleUtils = Pick<StyleUtils, AsyncKeys<StyleUtils>>;
type SyncStyleUtils = Pick<StyleUtils, SyncKeys<StyleUtils>>;
export type SandboxGlobal = Record<string, unknown>;
export type SandboxCu = nsXPCComponents_Utils & nsIXPCComponents_Utils;
type UnknownArgsFunction = (...args: unknown[]) => unknown;
type UnknownArgsVoidFunction = (...args: unknown[]) => void;
type UnknownPromiseFunction = (...args: unknown[]) => Promise<unknown>;
type RuntimeSerializableFunction = (...args: never[]) => unknown;
type LanguagePreference = string | readonly string[];
export type StyleDebugSink = (message: string) => void;

type StyleDebugBudget = {
  lines: number;
  truncated: boolean;
};

export type StyleDebugContext = {
  sink?: StyleDebugSink;
  budget: StyleDebugBudget | null;
};

export function createStyleDebugContext(
  sink?: StyleDebugSink,
): StyleDebugContext {
  return { sink, budget: null };
}

type StyleUtilityContext = {
  debug: StyleDebugContext;
};

type UtilityDefinitionMap = {
  [K in keyof StyleUtils]: K extends AsyncKeys<StyleUtils>
    ? HostAsyncUtilityEntry
    : K extends SyncKeys<StyleUtils>
      ? LocalUtilityEntry | HostSyncUtilityEntry
      : never;
};

type UtilityFactoryMap = {
  [K in keyof StyleUtils]: K extends AsyncKeys<StyleUtils>
    ? HostAsyncUtilityFactoryEntry<K>
    : K extends SyncKeys<StyleUtils>
      ? LocalUtilityFactoryEntry<K> | HostSyncUtilityFactoryEntry<K>
      : never;
};

type LocalUtilityEntry = {
  runtimeSource: string;
  buildHostHandler?: undefined;
};

type HostSyncUtilityEntry = {
  runtimeSource: string;
  buildHostHandler: (
    sandbox: SandboxGlobal,
    Cu: SandboxCu,
    context: StyleUtilityContext,
  ) => UnknownArgsFunction;
};

type HostAsyncUtilityEntry = {
  runtimeSource: string;
  buildHostHandler: (
    sandbox: SandboxGlobal,
    Cu: SandboxCu,
    context: StyleUtilityContext,
  ) => UnknownArgsVoidFunction;
};

type LocalUtilityFactoryEntry<K extends keyof StyleUtils> = {
  buildRuntimeSource: (name: K) => string;
  buildHostHandler?: undefined;
};

type HostSyncUtilityFactoryEntry<K extends keyof StyleUtils> = {
  buildRuntimeSource: (name: K) => string;
  buildHostHandler: (
    name: K,
    sandbox: SandboxGlobal,
    Cu: SandboxCu,
    context: StyleUtilityContext,
  ) => UnknownArgsFunction;
};

type HostAsyncUtilityFactoryEntry<K extends keyof StyleUtils> = {
  buildRuntimeSource: (name: K) => string;
  buildHostHandler: (
    name: K,
    sandbox: SandboxGlobal,
    Cu: SandboxCu,
    context: StyleUtilityContext,
  ) => UnknownArgsVoidFunction;
};

const MAX_UNIT_LIST_LENGTH = 10_000;
const MAX_STRING_ARRAY_LENGTH = 10_000;
const MAX_DEBUG_ARGUMENTS = 20;
const MAX_DEBUG_VALUE_LENGTH = 2_000;
const MAX_DEBUG_LINE_LENGTH = 8_000;
const MAX_DEBUG_LINES_PER_GENERATE = 1_000;

function runtimeSafeString(value: unknown): string {
  switch (typeof value) {
    case "string":
      return value;
    case "number":
    case "boolean":
      return String(value);
    default:
      return "";
  }
}

function truncateForBudget(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...[truncated ${value.length - maxLength} chars]`;
}

function formatDebugValue(value: unknown): string {
  let formatted: string;
  if (typeof value === "string") {
    formatted = value;
  } else if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value == null
  ) {
    formatted = String(value);
  } else {
    try {
      formatted = JSON.stringify(value);
    } catch {
      formatted = String(value);
    }
  }
  return truncateForBudget(formatted, MAX_DEBUG_VALUE_LENGTH);
}

function emitDebugLine(context: StyleDebugContext, line: string): void {
  try {
    context.sink?.(line);
  } catch {
    // ignore sink failures to avoid breaking style runtime
  }
}

function hostDebug(context: StyleDebugContext, ...values: unknown[]): string {
  const visibleValues = values.slice(0, MAX_DEBUG_ARGUMENTS);
  const omittedValues = Math.max(0, values.length - visibleValues.length);
  const suffix = omittedValues ? ` ...[${omittedValues} more args]` : "";
  const message = truncateForBudget(
    `${visibleValues.map(formatDebugValue).join(" ")}${suffix}`,
    MAX_DEBUG_LINE_LENGTH,
  );
  const budget = context.budget;

  if (budget && budget.lines >= MAX_DEBUG_LINES_PER_GENERATE) {
    if (!budget.truncated) {
      emitDebugLine(
        context,
        `[banyan style][debug] debug output exceeded ${MAX_DEBUG_LINES_PER_GENERATE} lines; further lines are suppressed.`,
      );
      budget.truncated = true;
    }
    return message;
  }

  if (budget) {
    budget.lines += 1;
  }
  emitDebugLine(context, `[banyan style][debug] ${message}`);
  return message;
}

export async function withGenerateDebugBudget<T>(
  context: StyleDebugContext,
  action: () => Promise<T>,
): Promise<T> {
  const previousBudget = context.budget;
  context.budget = { lines: 0, truncated: false };
  try {
    return await action();
  } finally {
    context.budget = previousBudget;
  }
}

export function activateGenerateDebugBudget(
  context: StyleDebugContext,
): () => void {
  const previousBudget = context.budget;
  let restored = false;
  context.budget = { lines: 0, truncated: false };
  return () => {
    if (restored) {
      return;
    }
    restored = true;
    context.budget = previousBudget;
  };
}

function hostUuid(): string {
  return crypto.randomUUID();
}

function assertArrayLengthWithinBudget(
  value: readonly unknown[],
  fieldName: string,
  maxLength: number,
): void {
  if (value.length > maxLength) {
    throw new Error(
      `${fieldName} has ${value.length} entries, exceeding limit ${maxLength}.`,
    );
  }
}

function runtimeSafeRecord(
  object: Record<string, unknown>,
): Record<string, string> {
  const target = object && typeof object === "object" ? object : {};
  return new Proxy(target, {
    set() {
      return false;
    },
    defineProperty() {
      return false;
    },
    deleteProperty() {
      return false;
    },
    setPrototypeOf() {
      return false;
    },
    preventExtensions() {
      return false;
    },
    get(currentTarget, prop) {
      if (typeof prop !== "string") {
        return "";
      }
      try {
        return runtimeSafeString(
          (currentTarget as Record<string, unknown>)[prop],
        );
      } catch {
        return "";
      }
    },
  }) as Record<string, string>;
}

function runtimeGetExtraValue(
  item: { extra?: Record<string, unknown> } | null | undefined,
  key: string,
): string;
function runtimeGetExtraValue(
  item: { extra?: Record<string, unknown> } | null | undefined,
  key: string,
  mode: "string",
): string;
function runtimeGetExtraValue(
  item: { extra?: Record<string, unknown> } | null | undefined,
  key: string,
  mode: "array",
): string[];
function runtimeGetExtraValue(
  item: { extra?: Record<string, unknown> } | null | undefined,
  key: string,
  mode?: "string" | "array",
): string | string[] {
  const safeString = (value: unknown): string => {
    switch (typeof value) {
      case "string":
        return value;
      case "number":
      case "boolean":
        return String(value);
      default:
        return "";
    }
  };
  const source =
    item && typeof item === "object"
      ? (item as Record<string, unknown>).extra
      : undefined;
  const extra =
    source && typeof source === "object"
      ? (source as Record<string, unknown>)
      : {};
  const value = extra[safeString(key)];

  if (mode === "array") {
    if (value === undefined) {
      return [];
    }
    return Array.isArray(value) ? value.map(safeString) : [safeString(value)];
  }
  if (Array.isArray(value)) {
    return safeString(value[0]);
  }
  return safeString(value);
}

export function runtimeFormatDate<T>(
  value: string | number,
  callback: (parts: { year: string; month: string; day: string }) => T,
): T | string {
  if (typeof value === "number") {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return callback({
      year: String(date.getUTCFullYear()),
      month: String(date.getUTCMonth() + 1).padStart(2, "0"),
      day: String(date.getUTCDate()).padStart(2, "0"),
    });
  }

  const source = value.trim();
  if (!source) return value;

  type DateParts = { year: string; month: string; day: string };
  const monthNames: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };
  const createParts = (
    year: string,
    month = "",
    day = "",
  ): DateParts | undefined => {
    const yearNumber = Number(year);
    const monthNumber = month ? Number(month) : 0;
    const dayNumber = day ? Number(day) : 0;
    if (!/^\d{1,4}$/.test(year) || yearNumber < 1) return undefined;
    if (month && (monthNumber < 1 || monthNumber > 12)) return undefined;
    if (day) {
      const date = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber));
      if (
        dayNumber < 1 ||
        dayNumber > 31 ||
        date.getUTCFullYear() !== yearNumber ||
        date.getUTCMonth() !== monthNumber - 1 ||
        date.getUTCDate() !== dayNumber
      ) {
        return undefined;
      }
    }
    return {
      year: year.padStart(4, "0"),
      month: month ? String(monthNumber).padStart(2, "0") : "",
      day: day ? String(dayNumber).padStart(2, "0") : "",
    };
  };
  const numeric = /^(\d{4})[-/.]?(\d{2})[-/.]?(\d{2})$/.exec(source);
  const yearMonth = /^(\d{1,4})[-/.](\d{1,2})(?:$|[T\s])/.exec(source);
  const ymd = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[T\s])/.exec(source);
  const slashDate = /^(\d{1,2})[/-](\d{1,2})[/-](\d{1,4})(?:$|\s)/.exec(source);
  const named =
    /^(?:(\d{1,2})\s+)?([A-Za-z]+)(?:\s+(\d{1,2}))?,?\s+(\d{1,4})$/.exec(
      source,
    );
  const yearNamed = /^(\d{1,4})\s+([A-Za-z]+)(?:\s+(\d{1,2}))?$/.exec(source);
  const chinese = /^(\d{1,4})年(?:\s*(\d{1,2})月)?(?:\s*(\d{1,2})日)?$/.exec(
    source,
  );
  let parts: DateParts | undefined;

  if (numeric) {
    parts = createParts(numeric[1], numeric[2], numeric[3]);
  } else if (ymd) {
    parts = createParts(ymd[1], ymd[2], ymd[3]);
  } else if (yearMonth) {
    parts = createParts(yearMonth[1], yearMonth[2]);
  } else if (slashDate) {
    const first = Number(slashDate[1]);
    const second = Number(slashDate[2]);
    const month = first > 12 ? second : first;
    const day = first > 12 ? first : second;
    parts = createParts(slashDate[3], String(month), String(day));
  } else if (named || yearNamed) {
    const monthName = (named ? named[2] : yearNamed?.[2])?.toLowerCase();
    const month = monthNames[monthName ?? ""];
    const year = named ? named[4] : yearNamed?.[1];
    const day = named ? named[1] || named[3] : yearNamed?.[3];
    if (month && year) parts = createParts(year, String(month), day);
  } else if (chinese) {
    parts = createParts(chinese[1], chinese[2], chinese[3]);
  }

  return parts ? callback(parts) : value;
}

function runtimeIsArrayIndexKey(value: string): boolean {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    return false;
  }

  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0;
}

function runtimeWrapContextView(input: unknown): unknown {
  const seen = new WeakMap<object, unknown>();
  const readonlyTrap = {
    set() {
      return false;
    },
    defineProperty() {
      return false;
    },
    deleteProperty() {
      return false;
    },
    setPrototypeOf() {
      return false;
    },
    preventExtensions() {
      return false;
    },
  };

  const wrap = (value: unknown): unknown => {
    if (!value || typeof value !== "object") {
      return value;
    }

    const cached = seen.get(value as object);
    if (cached) {
      return cached;
    }

    if (Array.isArray(value)) {
      const target: unknown[] = [];
      const proxy = new Proxy(target, {
        ...readonlyTrap,
        get(currentTarget, prop, receiver) {
          if (typeof prop !== "string") {
            return Reflect.get(currentTarget, prop, receiver);
          }

          const result = Reflect.get(currentTarget, prop, receiver);
          if (
            prop === "length" ||
            runtimeIsArrayIndexKey(prop) ||
            typeof result === "function"
          ) {
            return result;
          }

          return result;
        },
      });
      seen.set(value as object, proxy);
      for (const entry of value) {
        target.push(wrap(entry));
      }
      return proxy;
    }

    const target = Object.create(null) as Record<string, unknown>;
    const proxy = new Proxy(target, {
      ...readonlyTrap,
      get(currentTarget, prop, receiver) {
        if (typeof prop !== "string") {
          return Reflect.get(currentTarget, prop, receiver);
        }

        if (!Object.prototype.hasOwnProperty.call(currentTarget, prop)) {
          return "";
        }

        const result = Reflect.get(currentTarget, prop, receiver);
        return result === undefined ? "" : result;
      },
    });
    seen.set(value as object, proxy);
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>,
    )) {
      target[key] = wrap(nested);
    }
    return proxy;
  };

  return wrap(input);
}

function hostText(value: PrintableValue, style?: RenderStyle): TextUnit {
  return {
    value: normalizeTextValue(value),
    ...(style || {}),
  };
}

function hostPlainText(input: Unit | readonly Unit[]): string {
  return plainUnitText(input);
}

function hostGroup(units: Unit[], delimiter?: Unit): GroupUnit {
  return {
    type: "group",
    units: Array.isArray(units) ? units : [],
    delimiter: toHostUnit(delimiter),
  };
}

function hostAffix(unit: Unit, prefix?: Unit, suffix?: Unit): AffixUnit;
function hostAffix(input: Unit, prefix?: Unit, suffix?: Unit): AffixUnit {
  return {
    type: "affix",
    unit: input,
    prefix: toHostUnit(prefix),
    suffix: toHostUnit(suffix),
  };
}

function hostFallback(units: Unit[]): FallbackUnit {
  return { type: "fall", units };
}

function hostChoose(
  condition: boolean,
  trueUnit: Unit,
  flseUnit?: Unit,
): WhenUnit {
  return { type: "when", condition, trueUnit, flseUnit };
}

function hostTextCase(
  unit: Unit,
  form: TextCaseForm,
  ignoreWords?: string[],
): TextCaseUnit;
function hostTextCase(
  input: Unit,
  form: TextCaseForm,
  ignoreWords: string[] = [],
): TextCaseUnit {
  return {
    type: "text-case",
    unit: input,
    form,
    ignoreWords,
  };
}

function hostWithStyle(input: Unit, style: RenderStyle): WithStyleUnit {
  return {
    type: "style",
    unit: input,
    style,
  };
}

function hostLink(input: Unit, link: string): LinkUnit {
  return {
    type: "link",
    unit: input,
    link: sanitizeLink(link) ?? "",
  };
}

function toHostUnit(input?: Unit): Unit | undefined {
  if (input == null) {
    return undefined;
  }
  if (typeof input === "string" || typeof input === "number") {
    return Number.isFinite(input as number) || typeof input === "string"
      ? input
      : undefined;
  }

  const raw = input as Record<string, unknown>;
  if (typeof raw.type === "string") {
    switch (raw.type) {
      case "group":
        return {
          type: "group",
          units: normalizeUnitList(raw.units),
          delimiter: normalizeOptionalUnit(raw.delimiter),
        };
      case "affix": {
        const unit = normalizeUnitInput(raw.unit);
        if (!unit) {
          return undefined;
        }
        return {
          type: "affix",
          unit,
          prefix: normalizeOptionalUnit(raw.prefix),
          suffix: normalizeOptionalUnit(raw.suffix),
        };
      }
      case "fall":
        return {
          type: "fall",
          units: normalizeUnitList(raw.units),
        };
      case "when": {
        const trueUnit = normalizeUnitInput(raw.trueUnit);
        if (!trueUnit) {
          return undefined;
        }
        const flseUnit = normalizeUnitInput(raw.flseUnit);
        return {
          type: "when",
          condition: Boolean(raw.condition),
          trueUnit,
          flseUnit: flseUnit ?? undefined,
        };
      }
      case "text-case": {
        const unit = normalizeUnitInput(raw.unit);
        const form = normalizeTextCaseForm(raw.form);
        if (!unit || !form) {
          return undefined;
        }
        return {
          type: "text-case",
          unit,
          form,
          ignoreWords: normalizeStringArray(raw.ignoreWords),
        };
      }
      case "style": {
        const unit = normalizeUnitInput(raw.unit);
        if (!unit) {
          return undefined;
        }
        return {
          type: "style",
          unit,
          style: normalizeRenderStyle(raw.style),
        };
      }
      case "link": {
        const unit = normalizeUnitInput(raw.unit);
        const link = sanitizeLink(raw.link);
        if (!unit) {
          return undefined;
        }
        return link ? { type: "link", unit, link } : unit;
      }
      default:
        break;
    }
  }

  return normalizeTextUnit(raw);
}

export function normalizeUnitInput(input: unknown): Unit | null {
  if (typeof input === "string") {
    return input;
  }
  if (typeof input === "number") {
    return Number.isFinite(input) ? input : null;
  }
  if (!input || typeof input !== "object") {
    return null;
  }

  const raw = input as Record<string, unknown>;
  if (typeof raw.type !== "string") {
    return normalizeTextUnit(raw);
  }

  switch (raw.type) {
    case "group":
      return {
        type: "group",
        units: normalizeUnitList(raw.units),
        delimiter: normalizeOptionalUnit(raw.delimiter),
      };
    case "affix": {
      const unit = normalizeUnitInput(raw.unit);
      if (!unit) {
        return null;
      }
      return {
        type: "affix",
        unit,
        prefix: normalizeOptionalUnit(raw.prefix),
        suffix: normalizeOptionalUnit(raw.suffix),
      };
    }
    case "fall":
      return {
        type: "fall",
        units: normalizeUnitList(raw.units),
      };
    case "when": {
      const trueUnit = normalizeUnitInput(raw.trueUnit);
      if (!trueUnit) {
        return null;
      }
      const flseUnit = normalizeUnitInput(raw.flseUnit);
      return {
        type: "when",
        condition: Boolean(raw.condition),
        trueUnit,
        flseUnit: flseUnit ?? undefined,
      };
    }
    case "text-case": {
      const unit = normalizeUnitInput(raw.unit);
      const form = normalizeTextCaseForm(raw.form);
      if (!unit || !form) {
        return unit;
      }
      return {
        type: "text-case",
        unit,
        form,
        ignoreWords: normalizeStringArray(raw.ignoreWords),
      };
    }
    case "style": {
      const unit = normalizeUnitInput(raw.unit);
      if (!unit) {
        return unit;
      }
      return {
        type: "style",
        unit,
        style: normalizeRenderStyle(raw.style),
      };
    }
    case "link": {
      const unit = normalizeUnitInput(raw.unit);
      const link = sanitizeLink(raw.link);
      if (!unit) {
        return unit;
      }
      return link ? { type: "link", unit, link } : unit;
    }
    default:
      return normalizeTextUnit(raw);
  }
}

export function normalizeUnitList(input: unknown): Unit[] {
  if (!Array.isArray(input)) {
    return [];
  }

  assertArrayLengthWithinBudget(input, "Unit[]", MAX_UNIT_LIST_LENGTH);
  return input
    .map((item) => normalizeUnitInput(item))
    .filter((item): item is Unit => item != null);
}

export function normalizeOptionalUnit(input: unknown): Unit | undefined {
  if (input == null) {
    return undefined;
  }
  return normalizeUnitInput(input) ?? undefined;
}

export function normalizeTextCaseForm(form: unknown): TextCaseForm | undefined {
  switch (form) {
    case "lower":
    case "upper":
    case "small-caps":
    case "title":
    case "sentence":
    case "name":
      return form;
    default:
      return undefined;
  }
}

export function normalizeStringArray(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }

  assertArrayLengthWithinBudget(input, "string[]", MAX_STRING_ARRAY_LENGTH);
  const values = input.map((item) => String(item ?? "")).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

export function normalizeRenderStyle(input: unknown): RenderStyle {
  if (!input || typeof input !== "object") {
    return {};
  }
  const raw = input as Record<string, unknown>;
  const out: RenderStyle = {};
  if (typeof raw.italic === "boolean") out.italic = raw.italic;
  if (typeof raw.bold === "boolean") out.bold = raw.bold;
  if (raw.script === "superscript" || raw.script === "subscript") {
    out.script = raw.script;
  }
  if (typeof raw.color === "string") out.color = raw.color;
  if (typeof raw.backgroundColor === "string") {
    out.backgroundColor = raw.backgroundColor;
  }
  return out;
}

export function normalizeTextUnit(input: Record<string, unknown>): TextUnit {
  const value = normalizeTextValue(input.value);
  const out: TextUnit = { value };
  if (typeof input.italic === "boolean") out.italic = input.italic;
  if (typeof input.bold === "boolean") out.bold = input.bold;
  if (input.script === "superscript" || input.script === "subscript") {
    out.script = input.script;
  }
  if (typeof input.color === "string") out.color = input.color;
  if (typeof input.backgroundColor === "string") {
    out.backgroundColor = input.backgroundColor;
  }
  return out;
}

function normalizeLanguageTag(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/_/g, "-")
    .toLowerCase();
}

function normalizeLanguagePreferences(language: LanguagePreference): string[] {
  const inputs = Array.isArray(language) ? language : [language];
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const input of inputs) {
    const value = normalizeLanguageTag(input);
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }

  return normalized;
}

function matchesLanguage(candidate: unknown, language: string): boolean {
  const normalizedCandidate = normalizeLanguageTag(candidate);
  if (!normalizedCandidate || !language) {
    return false;
  }

  return (
    normalizedCandidate === language ||
    normalizedCandidate.startsWith(`${language}-`) ||
    language.startsWith(`${normalizedCandidate}-`)
  );
}

function serializeSandboxRuntimeFunction(
  exportedName: keyof StyleUtils,
  fn: RuntimeSerializableFunction,
): string {
  return serializeSandboxRuntimeBinding(String(exportedName), fn);
}

function serializeHostSyncRuntimeFunction(
  exportedName: keyof StyleUtils,
): string {
  return `const ${exportedName} = function (...args) { return __host.${exportedName}(...args); };`;
}

function serializeHostAsyncRuntimeFunction(
  exportedName: keyof StyleUtils,
): string {
  return `const ${exportedName} = function (...args) { return new Promise((resolve, reject) => { __host.${exportedName}(...args, resolve, reject); }); };`;
}

function serializeReadonlyHostAsyncRuntimeFunction(
  exportedName: keyof StyleUtils,
): string {
  return `const ${exportedName} = function (...args) { return new Promise((resolve, reject) => { __host.${exportedName}(...args, (value) => { resolve(typeof __banyanWrapContextView__ === "function" ? __banyanWrapContextView__(value) : value); }, reject); }); };`;
}

function serializeSandboxRuntimeBinding(
  bindingName: string,
  fn: RuntimeSerializableFunction,
): string {
  const serialized = `const ${bindingName} = ${fn.toString()};`;
  const originalName = fn.name?.trim();

  if (
    !originalName ||
    originalName === bindingName ||
    !/^[A-Za-z_$][\w$]*$/.test(originalName)
  ) {
    return serialized;
  }

  return `${serialized}\nconst ${originalName} = ${bindingName};`;
}

function defineLocalUtility<K extends keyof SyncStyleUtils>(
  runtime: SyncStyleUtils[K],
): LocalUtilityFactoryEntry<K> {
  return {
    buildRuntimeSource: (name) =>
      serializeSandboxRuntimeFunction(name, runtime as UnknownArgsFunction),
  };
}

function defineCloningHostSyncUtility<K extends keyof SyncStyleUtils>(
  host: SyncStyleUtils[K],
): HostSyncUtilityFactoryEntry<K> {
  return {
    buildRuntimeSource: (name) => serializeHostSyncRuntimeFunction(name),
    buildHostHandler:
      (_name, sandbox, Cu, _context) =>
      (...args: unknown[]) =>
        cloneHostUtilityResult(
          (host as UnknownArgsFunction)(...args),
          sandbox,
          Cu,
        ),
  };
}

function cloneHostUtilityResult<T>(
  value: T,
  sandbox: SandboxGlobal,
  Cu: SandboxCu,
): T {
  if (
    !value ||
    typeof value !== "object" ||
    typeof Cu?.cloneInto !== "function"
  ) {
    return value;
  }

  return Cu.cloneInto(value, sandbox, {
    cloneFunctions: false,
  }) as T;
}

function defineHostAsyncUtility<K extends keyof AsyncStyleUtils>(
  host: AsyncStyleUtils[K],
): HostAsyncUtilityFactoryEntry<K> {
  return {
    buildRuntimeSource: (name) => serializeHostAsyncRuntimeFunction(name),
    buildHostHandler: (name, sandbox, Cu, _context) =>
      createAsyncHostBridgeHandler(name, host, sandbox, Cu),
  };
}

function defineReadonlyHostAsyncUtility<K extends keyof AsyncStyleUtils>(
  host: AsyncStyleUtils[K],
): HostAsyncUtilityFactoryEntry<K> {
  return {
    buildRuntimeSource: (name) =>
      serializeReadonlyHostAsyncRuntimeFunction(name),
    buildHostHandler: (name, sandbox, Cu, _context) =>
      createAsyncHostBridgeHandler(name, host, sandbox, Cu),
  };
}

function materializeUtilityDefinitions(
  definitions: UtilityFactoryMap,
): UtilityDefinitionMap {
  const materialized: Record<
    string,
    LocalUtilityEntry | HostSyncUtilityEntry | HostAsyncUtilityEntry
  > = {};

  for (const name of Object.keys(definitions) as Array<keyof StyleUtils>) {
    const definition = definitions[name] as {
      buildRuntimeSource: (name: keyof StyleUtils) => string;
      buildHostHandler?: (
        name: keyof StyleUtils,
        sandbox: SandboxGlobal,
        Cu: SandboxCu,
        context: StyleUtilityContext,
      ) => UnknownArgsFunction;
    };

    const runtimeSource = definition.buildRuntimeSource(name);
    const buildHostHandlerFactory = definition.buildHostHandler;

    if (!buildHostHandlerFactory) {
      materialized[name] = { runtimeSource };
      continue;
    }

    materialized[name] = {
      runtimeSource,
      buildHostHandler: (
        sandbox: SandboxGlobal,
        Cu: SandboxCu,
        context: StyleUtilityContext,
      ) => buildHostHandlerFactory(name, sandbox, Cu, context),
    };
  }

  return materialized as UtilityDefinitionMap;
}

const UTILITY_DEFINITION_FACTORIES = {
  readBytes: defineHostAsyncUtility(readBytes),
  readText: defineHostAsyncUtility(readText),
  readJSON: defineHostAsyncUtility(readJSON),
  getMultilingualItems: defineReadonlyHostAsyncUtility(
    readMultilingualItemsForStyle,
  ),
  getMultilingualItem: defineReadonlyHostAsyncUtility(
    readMultilingualItemForStyle,
  ),
  text: defineCloningHostSyncUtility(hostText),
  plainText: defineCloningHostSyncUtility(hostPlainText),
  textCase: defineCloningHostSyncUtility(hostTextCase),
  debug: {
    buildRuntimeSource: (name) => serializeHostSyncRuntimeFunction(name),
    buildHostHandler:
      (_name, sandbox, Cu, context) =>
      (...args: unknown[]) =>
        cloneHostUtilityResult(hostDebug(context.debug, ...args), sandbox, Cu),
  },
  uuid: defineCloningHostSyncUtility(hostUuid),
  getExtraValue: defineLocalUtility(runtimeGetExtraValue),
  formatDate: defineLocalUtility(runtimeFormatDate),
  safeString: defineLocalUtility(runtimeSafeString),
  safeRecord: defineLocalUtility(runtimeSafeRecord),
  affix: defineCloningHostSyncUtility(hostAffix),
  group: defineCloningHostSyncUtility(hostGroup),
  fallback: defineCloningHostSyncUtility(hostFallback),
  when: defineCloningHostSyncUtility(hostChoose),
  withStyle: defineCloningHostSyncUtility(hostWithStyle),
  link: defineCloningHostSyncUtility(hostLink),
} as const satisfies UtilityFactoryMap;

const UTILITY_DEFINITIONS = materializeUtilityDefinitions(
  UTILITY_DEFINITION_FACTORIES,
);

export const RUNTIME_UTILITY_NAMES = Object.keys(UTILITY_DEFINITIONS) as Array<
  keyof StyleUtils
>;

function buildSandboxUtilitiesSource(): string {
  // Still generate a source string because Cu.evalInSandbox executes script text.
  // Unlike translator's dynamic eval wrapper, we compose this from typed TS functions
  // so function bodies remain editor-friendly and type-checked.
  const lines = ["(function (__host) {", '  "use strict";'];

  for (const name of RUNTIME_UTILITY_NAMES) {
    lines.push(`  ${UTILITY_DEFINITIONS[name].runtimeSource}`);
  }

  lines.push("  Object.defineProperties(globalThis, {");
  for (const name of RUNTIME_UTILITY_NAMES) {
    lines.push(
      `    ${name}: { value: ${name}, writable: false, configurable: false, enumerable: true },`,
    );
  }
  lines.push("  });");
  lines.push("})(__banyanHostUtils__);");
  return lines.join("\n");
}

const SANDBOX_UTILITIES_SOURCE = buildSandboxUtilitiesSource();

function serializeSandboxRuntimeHelper(
  name: string,
  fn: RuntimeSerializableFunction,
): string {
  return serializeSandboxRuntimeBinding(name, fn);
}

function buildSandboxContextViewSource(): string {
  const lines = ["(function () {", '  "use strict";'];
  lines.push(
    `  ${serializeSandboxRuntimeHelper("__banyanIsArrayIndexKey", runtimeIsArrayIndexKey)}`,
  );
  lines.push(
    `  ${serializeSandboxRuntimeHelper("__banyanWrapContextView", runtimeWrapContextView)}`,
  );
  lines.push(
    '  Object.defineProperty(globalThis, "__banyanWrapContextView__", { value: __banyanWrapContextView, writable: false, configurable: false, enumerable: false });',
  );
  lines.push("})();");
  return lines.join("\n");
}

const SANDBOX_CONTEXT_VIEW_SOURCE = buildSandboxContextViewSource();

export function installUtilities(
  sandbox: SandboxGlobal,
  Cu: SandboxCu,
  debugContext: StyleDebugContext = createStyleDebugContext(),
): void {
  const hostBridge = (
    Cu.createObjectIn ? Cu.createObjectIn(sandbox) : {}
  ) as Record<string, unknown>;

  for (const [name, fn] of Object.entries(
    createHostUtilityHandlers(sandbox, Cu, { debug: debugContext }),
  )) {
    if (typeof fn !== "function") continue;

    if (Cu.exportFunction) {
      Cu.exportFunction(fn, hostBridge, { defineAs: name });
    } else {
      hostBridge[name] = fn;
    }
  }

  sandbox.__banyanHostUtils__ = hostBridge;
  try {
    Cu.evalInSandbox(
      SANDBOX_UTILITIES_SOURCE,
      sandbox,
      "1.8",
      "banyan-style-utils.js",
      1,
    );
  } finally {
    try {
      delete sandbox.__banyanHostUtils__;
    } catch {
      // ignore cleanup failure
    }
  }
}

export function installContextViewRuntime(
  sandbox: SandboxGlobal,
  Cu: SandboxCu,
): void {
  Cu.evalInSandbox(
    SANDBOX_CONTEXT_VIEW_SOURCE,
    sandbox,
    "1.8",
    "banyan-style-context-view.js",
    1,
  );
}

export function installSandboxContexts(
  contexts: unknown,
  sandbox: SandboxGlobal,
  Cu: SandboxCu,
): void {
  sandbox.__banyanRawContexts__ = cloneValueIntoSandbox(contexts, sandbox, Cu);

  try {
    Cu.evalInSandbox(
      [
        'Object.defineProperty(globalThis, "contexts", {',
        '  value: typeof __banyanWrapContextView__ === "function"',
        "    ? __banyanWrapContextView__(__banyanRawContexts__)",
        "    : __banyanRawContexts__,",
        "  writable: false,",
        "  configurable: true,",
        "  enumerable: true,",
        "});",
      ].join("\n"),
      sandbox,
      "1.8",
      "banyan-style-contexts.js",
      1,
    );
  } finally {
    try {
      delete sandbox.__banyanRawContexts__;
    } catch {
      // ignore cleanup failure
    }
  }
}

function createHostUtilityHandlers(
  sandbox: SandboxGlobal,
  Cu: SandboxCu,
  context: StyleUtilityContext,
): Record<string, UnknownArgsFunction> {
  const handlers: Record<string, UnknownArgsFunction> = {};

  for (const name of RUNTIME_UTILITY_NAMES) {
    const buildHostHandler = UTILITY_DEFINITIONS[name].buildHostHandler;
    if (!buildHostHandler) {
      continue;
    }
    handlers[name] = buildHostHandler(sandbox, Cu, context);
  }

  return handlers;
}

function createAsyncHostBridgeHandler<K extends keyof AsyncStyleUtils>(
  name: K,
  host: AsyncStyleUtils[K],
  sandbox: SandboxGlobal,
  Cu: SandboxCu,
): UnknownArgsVoidFunction {
  const hostBridge = host as UnknownPromiseFunction;

  return (...args: unknown[]) => {
    const resolve = args[args.length - 2];
    const reject = args[args.length - 1];
    const params = args.slice(0, -2);

    if (typeof resolve !== "function" || typeof reject !== "function") {
      throw new TypeError(
        `Host bridge '${name}' expects resolve/reject callbacks.`,
      );
    }

    settleBridgePromise(
      Promise.resolve(hostBridge(...params)),
      sandbox,
      Cu,
      resolve as (value: unknown) => void,
      reject as (reason: unknown) => void,
    );
  };
}

function settleBridgePromise(
  promise: Promise<unknown>,
  sandbox: SandboxGlobal,
  Cu: SandboxCu,
  resolve: (value: unknown) => void,
  reject: (reason: unknown) => void,
): void {
  Promise.resolve(promise).then(
    (value) => {
      try {
        resolve(cloneValueIntoSandbox(value, sandbox, Cu));
      } catch (error) {
        reject(error instanceof Error ? error.message : String(error));
      }
    },
    (error) => {
      reject(error instanceof Error ? error.message : String(error));
    },
  );
}

function cloneValueIntoSandbox<T>(
  value: T,
  sandbox: SandboxGlobal,
  Cu: SandboxCu,
): T {
  const clonedValue = cloneValueWithMaintainedAPI(value);

  if (typeof Cu?.cloneInto !== "function") {
    throw new Error("cloneInto is unavailable in sandbox host environment.");
  }

  return Cu.cloneInto(clonedValue, sandbox, {
    cloneFunctions: false,
  }) as T;
}

function cloneValueWithMaintainedAPI<T>(value: T): T {
  const hostStructuredClone =
    (typeof globalThis.structuredClone === "function"
      ? globalThis.structuredClone
      : undefined) ||
    (ztoolkit.getGlobal("structuredClone") as
      ((input: unknown) => unknown) | undefined);

  if (typeof hostStructuredClone !== "function") {
    throw new Error("structuredClone is unavailable in host environment.");
  }

  return hostStructuredClone(value) as T;
}

function normalizePathForContainment(path: string): string {
  const normalized = PathUtils.normalize(path).replace(/\\/g, "/");
  const trimmed = normalized.replace(/\/+$/g, "");
  return Zotero.isWin ? trimmed.toLowerCase() : trimmed;
}

function isPathInsideDirectory(candidate: string, directory: string): boolean {
  const normalizedCandidate = normalizePathForContainment(candidate);
  const normalizedDirectory = normalizePathForContainment(directory);
  return (
    normalizedCandidate === normalizedDirectory ||
    normalizedCandidate.startsWith(`${normalizedDirectory}/`)
  );
}

function resolvePath(path: string): string {
  const dataDir = Zotero.DataDirectory.dir;
  const banyanDir = PathUtils.normalize(PathUtils.join(dataDir, "banyan"));
  if (typeof path !== "string" || !path.trim()) {
    throw new Error("Invalid path to resolve");
  }
  const rawPath = path.trim();
  const isAbs =
    /^[a-zA-Z]:/.test(rawPath) ||
    rawPath.startsWith("/") ||
    rawPath.startsWith("\\");
  const candidate = isAbs ? rawPath : PathUtils.join(banyanDir, rawPath);
  const normalized = PathUtils.normalize(candidate);
  if (!isPathInsideDirectory(normalized, banyanDir)) {
    throw new Error("Only files in banyan data directory are allowed");
  }
  return normalized;
}

async function readBytes(
  relPath: string,
  options?: ReadOptions,
): Promise<Uint8Array> {
  return IOUtils.read(resolvePath(relPath), options);
}

async function readText(
  relPath: string,
  options?: ReadUTF8Options,
): Promise<string> {
  return IOUtils.readUTF8(resolvePath(relPath), options);
}

async function readJSON<T = unknown>(
  relPath: string,
  options?: ReadUTF8Options,
): Promise<T> {
  return IOUtils.readJSON(resolvePath(relPath), options);
}

async function resolveStyleItem<T extends ScriptItem>(
  item: T,
): Promise<{
  sourceItem: T;
  zoteroItem?: Zotero.Item;
}> {
  if (!isBanyanItem(item)) {
    throw new TypeError(
      "Multilingual utilities expect a Banyan item from citation contexts.",
    );
  }

  const zoteroItem = await Zotero.Items.getAsync(item.id);
  return {
    sourceItem: zoteroItem ? (toBanyanItem(zoteroItem) as unknown as T) : item,
    zoteroItem: zoteroItem ?? undefined,
  };
}

async function readMultilingualItemsForStyle<T extends ScriptItem>(
  item: T,
): Promise<T[]> {
  const { zoteroItem } = await resolveStyleItem(item);
  if (!zoteroItem) {
    return [];
  }

  const relatedItems = await getRelatedMultilingualItems(zoteroItem);
  return relatedItems.map(
    (relatedItem) => toBanyanItem(relatedItem) as unknown as T,
  );
}

async function readMultilingualItemForStyle<T extends ScriptItem>(
  item: T,
  language: LanguagePreference,
): Promise<T> {
  const preferences = normalizeLanguagePreferences(language);
  if (!preferences.length) {
    throw new TypeError(
      "getMultilingualItem expects a non-empty language selector.",
    );
  }

  const { sourceItem, zoteroItem } = await resolveStyleItem(item);
  if (
    preferences.some((preference) =>
      matchesLanguage(sourceItem.language, preference),
    )
  ) {
    return sourceItem;
  }
  if (!zoteroItem) {
    return sourceItem;
  }

  const relatedItems = await readMultilingualItemsForStyle(sourceItem);
  for (const preference of preferences) {
    const matched = relatedItems.find((candidate) =>
      matchesLanguage(candidate.language, preference),
    );
    if (matched) {
      return matched;
    }
  }

  return sourceItem;
}
