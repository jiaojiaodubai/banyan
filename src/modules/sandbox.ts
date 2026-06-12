// BAK_TEST_METHOD: method-direct-await-ablation-20260530-014241
// BAK_TEST_SOURCE: sandbox.ts.ablation-direct-20260530-014241.bak
// Sandbox loader for user-provided style scripts
// Responsibility:
// 1) Create a restricted JS sandbox (null principal, no privileged APIs)
// 2) Evaluate user code with minimal programmatic wrapper (STYLE_EXPORTS driven)
// 3) Extract exports and detect builtin shadowing on the host side
// 4) Bridge values across compartments (cloneInto/exportFunction)
// 5) Inject `contexts` as a readonly global, call `generate()`, normalize output
//
// References:
// - Xray vision: https://developer.mozilla.org/en-US/docs/Xray_vision
// - Components.utils.Sandbox: https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Language_Bindings/Components.utils.Sandbox
// - cloneInto/exportFunction: https://developer.mozilla.org/en-US/docs/Mozilla/JavaScript_code_modules/XPCOMUtils.jsm#Cross-Compartment_wrappers
import type {
  BibliographyLine,
  CitationStyleComponent,
  CiteStyleComponent,
  Citation,
  CitationContext,
  CitationSource,
  ScriptIntextCitation,
  ScriptNoteCitation,
  Style,
  StyleResult,
} from "../../typings/style";
import type { Item } from "../../typings/item";
import type {
  AffixUnit,
  WhenUnit,
  FallbackUnit,
  GroupUnit,
  PrintableValue,
  RenderStyle,
  WithStyleUnit,
  TextCaseForm,
  TextCaseUnit,
  TextUnit,
  Unit,
} from "../../typings/unit";
import type { StyleUtils } from "../../typings/styleUtils";
import {
  compile,
  normalizeTextValue,
  plainText as plainUnitText,
} from "./unit";
import { getMultilingualItems as getRelatedMultilingualItems } from "./relations";
import { isBanyanItem, toBanyanItem } from "../utils/item";

// --- 类型体操：自动推导异步/同步 util key 和类型 ---
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
type SandboxGlobal = Record<string, unknown>;
type SandboxCu = nsXPCComponents_Utils & nsIXPCComponents_Utils;
type UnknownArgsFunction = (...args: unknown[]) => unknown;
type UnknownArgsVoidFunction = (...args: unknown[]) => void;
type UnknownPromiseFunction = (...args: unknown[]) => Promise<unknown>;
type RuntimeSerializableFunction = (...args: never[]) => unknown;
type LanguagePreference = string | readonly string[];
type GenerateBridgeCallbacks = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};
type GenerateBridgeInvoker = (
  callbacks?: GenerateBridgeCallbacks,
) => Promise<unknown> | void;
export type StyleGenerateCallbacks = {
  resolve: (value: StyleResult) => void;
  reject: (reason: unknown) => void;
};
export type CallbackStyle = Style & {
  __banyanGenerateWithCallbacks?: (
    contexts: CitationContext[],
    callbacks: StyleGenerateCallbacks,
  ) => void;
};
export type StyleDebugSink = (message: string) => void;

type BanyanRuntimeError = Error & {
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
  cause?: unknown;
  banyanPhase?: string;
  banyanSourcePath?: string;
};

type SandboxScriptError = BanyanRuntimeError & {
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
  cause?: unknown;
};

let activeStyleDebugSink: StyleDebugSink | null = null;
let generateBridgeInvocationSequence = 0;

export async function withStyleDebugSink<T>(
  sink: StyleDebugSink,
  action: () => Promise<T>,
): Promise<T> {
  const previousSink = activeStyleDebugSink;
  activeStyleDebugSink = sink;
  try {
    return await action();
  } finally {
    activeStyleDebugSink = previousSink;
  }
}

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
  ) => UnknownArgsFunction;
};

type HostAsyncUtilityEntry = {
  runtimeSource: string;
  buildHostHandler: (
    sandbox: SandboxGlobal,
    Cu: SandboxCu,
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
  ) => UnknownArgsFunction;
};

type HostAsyncUtilityFactoryEntry<K extends keyof StyleUtils> = {
  buildRuntimeSource: (name: K) => string;
  buildHostHandler: (
    name: K,
    sandbox: SandboxGlobal,
    Cu: SandboxCu,
  ) => UnknownArgsVoidFunction;
};

/**
 * Names the sandbox must export. Defined once; wrapper and extraction
 * are both generated from this list — no manual string duplication.
 */
const STYLE_EXPORTS = ["INFO", "generate", "UI"] as const;

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

function formatDebugValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value == null
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function hostDebug(...values: unknown[]): string {
  const message = values.map(formatDebugValue).join(" ");
  const line = `[banyan style][debug] ${message}`;

  try {
    activeStyleDebugSink?.(line);
  } catch {
    // ignore sink failures to avoid breaking style runtime
  }

  return message;
}

function hostUuid(): string {
  return crypto.randomUUID();
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
  const normalizeKey = (value: unknown): string =>
    safeString(value)
      .replace(/[A-Z]/g, (char) => ` ${char.toLowerCase()}`)
      .replace(/[\s_]/g, "-")
      .trim();

  const source =
    item && typeof item === "object"
      ? (item as Record<string, unknown>).extra
      : undefined;
  const extra =
    source && typeof source === "object"
      ? (source as Record<string, unknown>)
      : {};
  const rawKey = safeString(key);
  const normalizedKey = normalizeKey(rawKey);
  const value =
    extra[rawKey] ??
    (normalizedKey && normalizedKey !== rawKey
      ? extra[normalizedKey]
      : undefined);

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

function hostWithStyle(input: Unit, style: RenderStyle): WithStyleUnit {
  return {
    type: "style",
    unit: input,
    style,
  };
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
      default:
        break;
    }
  }

  const value = normalizeTextValue(raw.value);
  const out: TextUnit = { value };
  if (typeof raw.italic === "boolean") out.italic = raw.italic;
  if (typeof raw.bold === "boolean") out.bold = raw.bold;
  if (raw.script === "superscript" || raw.script === "subscript") {
    out.script = raw.script;
  }
  if (typeof raw.link === "string") out.link = raw.link;
  if (typeof raw.color === "string") out.color = raw.color;
  if (typeof raw.backgroundColor === "string") {
    out.backgroundColor = raw.backgroundColor;
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

function _defineHostSyncUtility<K extends keyof SyncStyleUtils>(
  host: SyncStyleUtils[K],
): HostSyncUtilityFactoryEntry<K> {
  return {
    buildRuntimeSource: (name) => serializeHostSyncRuntimeFunction(name),
    buildHostHandler: () => host as UnknownArgsFunction,
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

function defineCloningHostSyncUtility<K extends keyof SyncStyleUtils>(
  host: SyncStyleUtils[K],
): HostSyncUtilityFactoryEntry<K> {
  return {
    buildRuntimeSource: (name) => serializeHostSyncRuntimeFunction(name),
    buildHostHandler:
      (_name, sandbox, Cu) =>
      (...args: unknown[]) =>
        cloneHostUtilityResult(
          (host as UnknownArgsFunction)(...args),
          sandbox,
          Cu,
        ),
  };
}

function defineHostAsyncUtility<K extends keyof AsyncStyleUtils>(
  host: AsyncStyleUtils[K],
): HostAsyncUtilityFactoryEntry<K> {
  return {
    buildRuntimeSource: (name) => serializeHostAsyncRuntimeFunction(name),
    buildHostHandler: (name, sandbox, Cu) =>
      createAsyncHostBridgeHandler(name, host, sandbox, Cu),
  };
}

function defineReadonlyHostAsyncUtility<K extends keyof AsyncStyleUtils>(
  host: AsyncStyleUtils[K],
): HostAsyncUtilityFactoryEntry<K> {
  return {
    buildRuntimeSource: (name) =>
      serializeReadonlyHostAsyncRuntimeFunction(name),
    buildHostHandler: (name, sandbox, Cu) =>
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
      buildHostHandler: (sandbox: SandboxGlobal, Cu: SandboxCu) =>
        buildHostHandlerFactory(name, sandbox, Cu),
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
  debug: defineCloningHostSyncUtility(hostDebug),
  uuid: defineCloningHostSyncUtility(hostUuid),
  getExtraValue: defineLocalUtility(runtimeGetExtraValue),
  safeString: defineLocalUtility(runtimeSafeString),
  safeRecord: defineLocalUtility(runtimeSafeRecord),
  affix: defineCloningHostSyncUtility(hostAffix),
  group: defineCloningHostSyncUtility(hostGroup),
  fallback: defineCloningHostSyncUtility(hostFallback),
  when: defineCloningHostSyncUtility(hostChoose),
  withStyle: defineCloningHostSyncUtility(hostWithStyle),
} as const satisfies UtilityFactoryMap;

const UTILITY_DEFINITIONS = materializeUtilityDefinitions(
  UTILITY_DEFINITION_FACTORIES,
);

const RUNTIME_UTILITY_NAMES = Object.keys(UTILITY_DEFINITIONS) as Array<
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

export async function createStyle(code: string): Promise<Style> {
  // 1) Build sandbox and evaluate user code
  const sandbox = buildSandbox();
  const exports = evalAndExtract(code, sandbox);

  // 2) Bridge values across compartments and normalize
  const bridged = bridgeAndNormalize(exports, sandbox);

  // 3) Final validation and soft hints
  validateStyle(bridged);

  return bridged;
}

/** Build the restricted sandbox */

function buildSandbox(): SandboxGlobal {
  const principal = Services.scriptSecurityManager.createNullPrincipal({});
  const sandbox = Cu.Sandbox(principal, {
    sandboxName: "Banyan:StyleSandbox",
    // Disable Xrays so callable properties (functions) on returned objects
    // are accessible from the host compartment. Security remains enforced via
    // null principal and explicit capability restrictions below.
    // See: https://developer.mozilla.org/en-US/docs/Xray_vision
    wantXrays: false,
    wantComponents: false,
  }) as unknown as SandboxGlobal;

  // Minimal console bridging to Zotero
  const styleLogPrefix = "[banyan style]";
  sandbox.console = {
    log: (...args: unknown[]) => ztoolkit.log(styleLogPrefix, ...args),
    error: (...args: unknown[]) => {
      try {
        const msg = `${styleLogPrefix} ${args.map(String).join(" ")}`;
        Zotero.logError(new Error(msg));
      } catch {
        // ignore logging failure
      }
    },
  };
  installUtilities(sandbox, Cu);
  installContextViewRuntime(sandbox, Cu);

  // 显式禁止危险能力
  const deny = (name: string) =>
    function () {
      throw new Error(`Disallowed API in style sandbox: ${name}`);
    };
  sandbox.fetch = deny("fetch");
  sandbox.XMLHttpRequest = deny("XMLHttpRequest");
  sandbox.WebSocket = deny("WebSocket");
  sandbox.window = undefined;
  sandbox.document = undefined;
  sandbox.navigator = undefined;
  sandbox.localStorage = undefined;
  sandbox.indexedDB = undefined;
  sandbox.caches = undefined;
  sandbox.Components = undefined;
  sandbox.Services = undefined;
  sandbox.Zotero = undefined;
  sandbox.IOUtils = undefined;
  sandbox.PathUtils = undefined;
  return sandbox;
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function inheritSandboxErrorMetadata(
  target: SandboxScriptError,
  source: unknown,
): void {
  const sourceRecord =
    source && typeof source === "object"
      ? (source as Record<string, unknown>)
      : null;
  if (!sourceRecord) {
    return;
  }

  const fileName =
    typeof sourceRecord.fileName === "string" && sourceRecord.fileName.trim()
      ? sourceRecord.fileName
      : undefined;
  const lineNumber = toFiniteNumber(sourceRecord.lineNumber);
  const columnNumber = toFiniteNumber(sourceRecord.columnNumber);
  const stack =
    typeof sourceRecord.stack === "string" && sourceRecord.stack.trim()
      ? sourceRecord.stack
      : undefined;

  if (fileName) {
    target.fileName = fileName;
  }
  if (lineNumber !== undefined) {
    target.lineNumber = lineNumber;
  }
  if (columnNumber !== undefined) {
    target.columnNumber = columnNumber;
  }
  if (stack) {
    target.stack = `${target.name}: ${target.message}\nCaused by: ${stack}`;
  }
}

function createBanyanRuntimeError(
  message: string,
  details?: Partial<BanyanRuntimeError>,
): BanyanRuntimeError {
  const error = new Error(message) as BanyanRuntimeError;
  if (details) {
    Object.assign(error, details);
  }
  return error;
}

function toHostGenerateError(reason: unknown): BanyanRuntimeError {
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : String(reason);
  const error = createBanyanRuntimeError(message);

  if (reason && typeof reason === "object") {
    const source = reason as Record<string, unknown>;
    if (typeof source.name === "string" && source.name) {
      error.name = source.name;
    }
    if (typeof source.banyanPhase === "string" && source.banyanPhase) {
      error.banyanPhase = source.banyanPhase;
    }
    if (
      typeof source.banyanSourcePath === "string" &&
      source.banyanSourcePath
    ) {
      error.banyanSourcePath = source.banyanSourcePath;
    }
    if ("cause" in source) {
      error.cause = source.cause;
    }
    inheritSandboxErrorMetadata(error as SandboxScriptError, reason);
  }

  return error;
}

function cloneValueIntoHost<T>(
  value: T,
  host: Record<string, unknown>,
  Cu: SandboxCu,
): T {
  let source = value;
  try {
    if (Cu.waiveXrays) {
      source = Cu.waiveXrays(value) as T;
    }
  } catch {
    // fall back to the original value
  }

  if (
    !source ||
    typeof source !== "object" ||
    typeof Cu?.cloneInto !== "function"
  ) {
    return source;
  }

  try {
    return Cu.cloneInto(source, host, {
      cloneFunctions: false,
    }) as T;
  } catch {
    return source;
  }
}

function dispatchHostTask(callback: () => void): void {
  const runnable = {
    run: callback,
  };
  const threadManager = Services.tm as unknown as {
    dispatchToMainThread?: (runnable: { run: () => void }) => void;
    mainThread?: {
      dispatch?: (runnable: { run: () => void }, flags: number) => void;
    };
  };

  if (typeof threadManager.dispatchToMainThread === "function") {
    threadManager.dispatchToMainThread(runnable);
    return;
  }

  if (typeof threadManager.mainThread?.dispatch === "function") {
    threadManager.mainThread.dispatch(runnable, 0);
    return;
  }

  setTimeout(callback, 0);
}

function exportGenerateFn(
  raw: unknown,
  sandbox: SandboxGlobal,
  host: Record<string, unknown>,
  Cu: SandboxCu,
): unknown {
  if (typeof raw !== "function") {
    return raw;
  }

  try {
    sandbox.__banyan_generate_raw__ = raw;
    Cu.evalInSandbox(
      [
        "this.__banyan_generate_invoke__ = function (callbackName) {",
        "  const callbacks = globalThis[callbackName];",
        '  if (!callbacks || typeof callbacks.resolve !== "function" || typeof callbacks.reject !== "function") {',
        '    throw new Error("Banyan generate bridge callbacks are unavailable.");',
        "  }",
        "  const resolve = callbacks.resolve;",
        "  const reject = callbacks.reject;",
        "  const rejectWith = function (error) {",
        "    const message =",
        '      error && typeof error.message === "string" && error.message',
        "        ? error.message",
        "        : String(error);",
        "    const wrapped = new Error(message);",
        '    if (error && typeof error.name === "string" && error.name) wrapped.name = error.name;',
        '    if (error && typeof error.fileName === "string" && error.fileName) wrapped.fileName = error.fileName;',
        '    if (error && typeof error.lineNumber === "number") wrapped.lineNumber = error.lineNumber;',
        '    if (error && typeof error.columnNumber === "number") wrapped.columnNumber = error.columnNumber;',
        '    if (error && typeof error.stack === "string" && error.stack) wrapped.stack = error.stack;',
        '    if (error && typeof error.banyanPhase === "string" && error.banyanPhase) wrapped.banyanPhase = error.banyanPhase;',
        '    if (error && typeof error.banyanSourcePath === "string" && error.banyanSourcePath) wrapped.banyanSourcePath = error.banyanSourcePath;',
        "    wrapped.cause = error;",
        "    reject(wrapped);",
        "  };",
        "  try {",
        "    const rawOut = __banyan_generate_raw__();",
        "    Promise.resolve(rawOut).then(",
        "      resolve,",
        "      rejectWith,",
        "    );",
        "    return;",
        "  } catch (error) {",
        "    rejectWith(error);",
        "  }",
        "};",
      ].join("\n"),
      sandbox,
      "1.8",
      "banyan-style-runtime.js",
      1,
    );

    const exportFunction = Cu.exportFunction;
    const createObjectIn = Cu.createObjectIn;
    if (
      typeof exportFunction !== "function" ||
      typeof createObjectIn !== "function"
    ) {
      throw createBanyanRuntimeError(
        "Banyan generate bridge requires Cu.exportFunction and Cu.createObjectIn.",
        {
          banyanPhase: "generate-bridge",
          banyanSourcePath: "generate()",
        },
      );
    }

    const runGenerateBridge = (
      resolveBridge: (value: unknown) => void,
      rejectBridge: (reason: unknown) => void,
    ): void => {
      generateBridgeInvocationSequence += 1;
      const callbackName = `__banyan_generate_callbacks_${generateBridgeInvocationSequence}`;
      const callbackContainer = createObjectIn(sandbox) as Record<
        string,
        unknown
      >;
      let cleanedUp = false;
      let settled = false;

      const cleanup = () => {
        if (cleanedUp) {
          return;
        }
        cleanedUp = true;
        try {
          delete sandbox[callbackName];
        } catch {
          // ignore cleanup failure
        }
      };

      const onResolve = (value: unknown) => {
        if (settled) {
          return;
        }
        settled = true;

        try {
          // MDN recommends not cloning Promise objects across realms. Keep
          // the Promise in the host realm, and only clone the resolved value
          // back on a host task.
          // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts/cloneInto
          dispatchHostTask(() => {
            try {
              const clonedValue = cloneValueIntoHost(value, host, Cu);
              resolveBridge(clonedValue);
            } catch (error) {
              rejectBridge(toHostGenerateError(error));
            }
          });
        } catch (error) {
          rejectBridge(toHostGenerateError(error));
        } finally {
          cleanup();
        }
      };

      const onReject = (reason: unknown) => {
        if (settled) {
          return;
        }
        settled = true;

        try {
          dispatchHostTask(() => {
            try {
              rejectBridge(toHostGenerateError(reason));
            } catch (error) {
              rejectBridge(toHostGenerateError(error));
            }
          });
        } catch (error) {
          rejectBridge(toHostGenerateError(error));
        } finally {
          cleanup();
        }
      };

      try {
        exportFunction(onResolve, callbackContainer, {
          defineAs: "resolve",
        });
        exportFunction(onReject, callbackContainer, {
          defineAs: "reject",
        });
        sandbox[callbackName] = callbackContainer;
        Cu.evalInSandbox(
          `__banyan_generate_invoke__(${JSON.stringify(callbackName)});`,
          sandbox,
          "1.8",
          "banyan-style-runtime.js",
          1,
        );
      } catch (error) {
        settled = true;
        cleanup();
        rejectBridge(toHostGenerateError(error));
      }
    };

    return function banyanHostGeneratePromise(
      callbacks?: GenerateBridgeCallbacks,
    ): Promise<unknown> | void {
      if (callbacks) {
        runGenerateBridge(callbacks.resolve, callbacks.reject);
        return;
      }

      return new Promise<unknown>((resolve, reject) => {
        runGenerateBridge(resolve, reject);
      });
    };
  } catch (error) {
    ztoolkit.logError(error);
    throw toHostGenerateError(error);
  }
}

/**
 * Evaluate user code in sandbox and programmatically extract exports.
 *
 * The wrapper string is minimal and mechanically generated from
 * STYLE_EXPORTS — no hand-written capture / shadow-check code in the
 * eval'd string.  Shadow detection is done on the host side by
 * comparing sandbox builtin references before and after eval.
 */
function evalAndExtract(
  code: string,
  sandbox: SandboxGlobal,
): Record<string, unknown> {
  // Snapshot builtin references before eval for shadow detection
  const builtinKeys = RUNTIME_UTILITY_NAMES;
  const builtinSnapshot = new Map<string, unknown>();
  for (const key of builtinKeys) {
    try {
      builtinSnapshot.set(key, sandbox[key]);
    } catch {
      /* noop */
    }
  }

  // Prepare the export container on the sandbox
  sandbox.__banyan_exports__ = Cu.createObjectIn
    ? Cu.createObjectIn(sandbox)
    : {};

  // Build minimal wrapper: IIFE that runs user code, then copies
  // known export names (and the `style` object fallback) into
  // __banyan_exports__.  Generated programmatically from STYLE_EXPORTS.
  const exportLines = STYLE_EXPORTS.map(
    (name) => `  if(typeof ${name}!=="undefined")__e.${name}=${name};`,
  ).join("\n");
  const styleFallbackLines = STYLE_EXPORTS.map(
    (name) =>
      `  if(!__e.${name}&&__s&&__s.${name}!=null)__e.${name}=__s.${name};`,
  ).join("\n");

  const wrapped =
    '"use strict";\n' +
    "(function(__e){\n" +
    code +
    "\n" +
    '  var __s=(typeof style!=="undefined")?style:undefined;\n' +
    exportLines +
    "\n" +
    styleFallbackLines +
    "\n" +
    "})(__banyan_exports__);\n";

  try {
    Cu.evalInSandbox(wrapped, sandbox, "1.8", "banyan-style.js", 1);
  } catch (e) {
    try {
      Zotero.logError(e instanceof Error ? e : new Error(String(e)));
    } catch {
      /* noop */
    }
    const wrappedError = new Error(
      `Failed to parse style script: ${String(e)}`,
    ) as SandboxScriptError;
    wrappedError.cause = e;
    inheritSandboxErrorMetadata(wrappedError, e);
    throw wrappedError;
  }

  // Host-side shadow detection: warn if any builtin was overwritten
  for (const [key, original] of builtinSnapshot) {
    try {
      if (sandbox[key] !== original) {
        ztoolkit.log(
          `Warning: Style script overwrote built-in '${key}'. ` +
            "This may cause unexpected behavior.",
        );
      }
    } catch {
      /* noop */
    }
  }

  // Read exports from the container
  const raw = sandbox.__banyan_exports__;
  const waived = (Cu.waiveXrays ? Cu.waiveXrays(raw) : raw) as Record<
    string,
    unknown
  >;
  const exports: Record<string, unknown> = {};
  for (const name of STYLE_EXPORTS) {
    exports[name] = waived[name];
  }

  // Cleanup
  try {
    delete sandbox.__banyan_exports__;
  } catch {
    /* noop */
  }

  return exports;
}

/**
 * Bridge values across compartments and build the host-side Style.
 *
 * The style script exports a single `generate()` function that returns
 * `{ citations, bibliography }`.  The host wrapper injects `contexts`
 * as a readonly global before calling it, then normalizes the output.
 */
function bridgeAndNormalize(
  exports: Record<string, unknown>,
  sandbox: SandboxGlobal,
): Style {
  const host: Record<string, unknown> = {};

  // --- Clone INFO into host compartment ---
  let INFO = exports.INFO;
  try {
    if (INFO && Cu.cloneInto) INFO = Cu.cloneInto(INFO, host);
  } catch {
    /* fall back to raw */
  }

  // --- Export generate from sandbox to host ---
  const generateRaw = exportGenerateFn(exports.generate, sandbox, host, Cu);

  // --- Normalize UI ---
  const rawUI = exports.UI as unknown;
  let UI:
    | { cite: CiteStyleComponent[]; citation: CitationStyleComponent[] }
    | undefined;
  if (rawUI) {
    const wavedUI = (Cu.waiveXrays ? Cu.waiveXrays(rawUI) : rawUI) as Record<
      string,
      unknown
    >;
    const cite = normalizeComponents(wavedUI.cite, host, "cite");
    const citation = normalizeComponents(wavedUI.citation, host, "citation");
    if (cite || citation) {
      UI = { cite: cite || [], citation: citation || [] };
    }
  }

  const infoRecord = (INFO ?? null) as Partial<
    Pick<Style["INFO"], "title" | "id" | "citationType">
  > | null;
  const styleName = String(
    infoRecord?.title || infoRecord?.id || "unknown-style",
  );
  const citationType = normalizeStyleCitationType(
    infoRecord?.citationType,
    styleName,
  );

  // --- Host-side generate wrappers ---
  const generate = async (
    contexts: CitationContext[],
  ): Promise<StyleResult> => {
    const taskStartedAt = Date.now();

    try {
      // Inject contexts as a readonly global with safe fallback for missing fields.
      installSandboxContexts(contexts, sandbox, Cu);

      const normalizeOut = (out: unknown): StyleResult => {
        return normalizeGenerateResult(
          out,
          contexts,
          styleName,
          citationType,
        ) as StyleResult;
      };

      if (typeof generateRaw !== "function") {
        return normalizeOut(generateRaw);
      }

      const out = await (generateRaw as () => Promise<unknown> | unknown)();
      return normalizeOut(out);
    } catch (e) {
      ztoolkit.logError(e instanceof Error ? e : String(e));
      ztoolkit.log(
        `[sandbox] generate failed: style=${styleName}, elapsedMs=${Date.now() - taskStartedAt}`,
      );
      throw e;
    }
  };

  const generateWithCallbacks = (
    contexts: CitationContext[],
    callbacks: StyleGenerateCallbacks,
  ): void => {
    const taskStartedAt = Date.now();

    try {
      // Inject contexts as a readonly global with safe fallback for missing fields.
      installSandboxContexts(contexts, sandbox, Cu);

      const normalizeOut = (out: unknown): StyleResult => {
        return normalizeGenerateResult(
          out,
          contexts,
          styleName,
          citationType,
        ) as StyleResult;
      };

      if (typeof generateRaw !== "function") {
        callbacks.resolve(normalizeOut(generateRaw));
        return;
      }

      const rejectGenerate = (e: unknown) => {
        ztoolkit.logError(e instanceof Error ? e : String(e));
        ztoolkit.log(
          `[sandbox] generate failed: style=${styleName}, elapsedMs=${Date.now() - taskStartedAt}`,
        );
        callbacks.reject(e);
      };

      try {
        (generateRaw as GenerateBridgeInvoker)({
          resolve: (out) => {
            try {
              callbacks.resolve(normalizeOut(out));
            } catch (error) {
              rejectGenerate(error);
            }
          },
          reject: rejectGenerate,
        });
      } catch (error) {
        rejectGenerate(error);
      }
    } catch (e) {
      ztoolkit.logError(e instanceof Error ? e : String(e));
      ztoolkit.log(
        `[sandbox] generate failed: style=${styleName}, elapsedMs=${Date.now() - taskStartedAt}`,
      );
      callbacks.reject(e);
    }
  };

  const bridged = { INFO, generate } as CallbackStyle;
  bridged.__banyanGenerateWithCallbacks = generateWithCallbacks;
  if (UI) bridged.UI = UI;
  return bridged;
}

/**
 * Validate and normalize the raw output of `generate()`.
 * Expects `{ citations: [...], bibliography: [...] }`.
 */
function normalizeGenerateResult(
  raw: unknown,
  contexts: CitationContext[],
  styleName: string,
  citationType: Style["INFO"]["citationType"],
): { citations: unknown; bibliography: unknown } {
  if (!raw || typeof raw !== "object") {
    const message =
      raw === undefined
        ? `Style "${styleName}" function generate has no return value. Please return { citations, bibliography }.`
        : `Style "${styleName}" function generate returned invalid value. Expected { citations, bibliography }.`;
    ztoolkit.logError(message);
    try {
      Zotero.getMainWindow().alert(message);
    } catch {
      /* noop */
    }
    throw createBanyanRuntimeError(message, {
      banyanPhase: "generate-output",
      banyanSourcePath: "generate()",
    });
  }

  const result = raw as Record<string, unknown>;
  const rawCitations = result.citations;
  const rawBibliography = result.bibliography;

  if (!Array.isArray(rawCitations)) {
    const message = `Style "${styleName}" generate().citations is not an array.`;
    ztoolkit.logError(message);
    throw createBanyanRuntimeError(message, {
      banyanPhase: "generate-output",
      banyanSourcePath: "generate().citations",
    });
  }
  if (!Array.isArray(rawBibliography)) {
    const message = `Style "${styleName}" generate().bibliography is not an array.`;
    ztoolkit.logError(message);
    throw createBanyanRuntimeError(message, {
      banyanPhase: "generate-output",
      banyanSourcePath: "generate().bibliography",
    });
  }

  const contextById = new Map(contexts.map((ctx) => [ctx.id, ctx]));
  const citations = rawCitations.map((citation, index) =>
    normalizeCitation(
      citation,
      contextById,
      citationType,
      `citations[${index}]`,
    ),
  );
  const bibliography = rawBibliography.map((line, index) =>
    normalizeBibliographyLine(line, `bibliography[${index}]`),
  );

  return { citations, bibliography };
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

function installSandboxContexts(
  contexts: CitationContext[],
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

function cloneValueWithMaintainedAPI<T>(value: T): T {
  const hostStructuredClone =
    (typeof globalThis.structuredClone === "function"
      ? globalThis.structuredClone
      : undefined) ||
    (ztoolkit.getGlobal("structuredClone") as
      | ((input: unknown) => unknown)
      | undefined);

  if (typeof hostStructuredClone !== "function") {
    throw new Error("structuredClone is unavailable in host environment.");
  }

  return hostStructuredClone(value) as T;
}

function normalizeCitation(
  input: unknown,
  contextById: Map<string, CitationContext>,
  citationType: Style["INFO"]["citationType"],
  outputPath: string,
): Citation {
  const citation = input as ScriptIntextCitation | ScriptNoteCitation;
  const citationRecord = citation as Record<string, unknown>;
  const id = requireNonEmptyString(citationRecord.id, `${outputPath}.id`);
  const matchedContext = contextById.get(id);
  if (!matchedContext) {
    throw createBanyanRuntimeError(
      `Citation output id "${id}" cannot be matched to input contexts.`,
      {
        banyanPhase: "generate-output",
        banyanSourcePath: `${outputPath}.id`,
      },
    );
  }

  const source: CitationSource = {
    cites: matchedContext.cites,
    params: matchedContext.params,
  };

  const rawCitation = citation as Record<string, unknown>;
  const { units: _rawUnits, type: _rawType, ...rest } = rawCitation;
  const normalized: Citation & { reference?: TextUnit[] } = {
    ...(rest as Omit<Citation, "id" | "source" | "units">),
    id,
    type: citationType,
    source,
    units: normalizeRequiredTopLevelUnit(_rawUnits, `${outputPath}.units`),
  };
  void _rawType;
  if (citationType === "note-citation") {
    normalized.reference = normalizeRequiredTopLevelUnit(
      citationRecord.reference,
      `${outputPath}.reference`,
    );
  }
  return normalized;
}

function normalizeStyleCitationType(
  input: unknown,
  styleName: string,
): Style["INFO"]["citationType"] {
  switch (input) {
    case "intext-citation":
    case "note-citation":
      return input;
    default:
      throw createBanyanRuntimeError(
        `Style "${styleName}" has invalid INFO.citationType. Expected "intext-citation" or "note-citation".`,
        {
          banyanPhase: "style-contract",
          banyanSourcePath: "INFO.citationType",
        },
      );
  }
}

function normalizeBibliographyLine(
  input: unknown,
  outputPath: string,
): BibliographyLine {
  const line = (input ?? {}) as Record<string, unknown>;
  const type = normalizeBibliographyLineType(line.type, `${outputPath}.type`);
  const units = normalizeRequiredTopLevelUnit(
    line.units,
    `${outputPath}.units`,
  );

  if (type === "bibliography-title") {
    return {
      type: "bibliography-title",
      units,
    };
  }

  return {
    id: requireNonEmptyString(line.id, `${outputPath}.id`),
    type: "bibliography-entry",
    units,
  };
}

function normalizeBibliographyLineType(
  value: unknown,
  fieldName: string,
): BibliographyLine["type"] {
  switch (value) {
    case "bibliography-title":
    case "bibliography-entry":
      return value;
    default:
      throw createBanyanRuntimeError(
        `${fieldName} must be "bibliography-title" or "bibliography-entry".`,
        {
          banyanPhase: "generate-output",
          banyanSourcePath: fieldName,
        },
      );
  }
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  const out = typeof value === "string" ? value.trim() : "";
  if (!out) {
    throw createBanyanRuntimeError(`${fieldName} must be a non-empty string.`, {
      banyanPhase: "generate-output",
      banyanSourcePath: fieldName,
    });
  }
  return out;
}

function normalizeRequiredTopLevelUnit(
  input: unknown,
  fieldName: string,
): TextUnit[] {
  if (input == null) {
    throw createBanyanRuntimeError(`${fieldName} is required.`, {
      banyanPhase: "generate-output",
      banyanSourcePath: fieldName,
    });
  }
  return normalizeTopLevelUnit(input, fieldName);
}

function normalizeTopLevelUnit(input: unknown, fieldName: string): TextUnit[] {
  if (Array.isArray(input)) {
    throw createBanyanRuntimeError(
      `${fieldName} must be a single Unit. Use group([...]) or fallback([...]) to combine multiple units.`,
      {
        banyanPhase: "generate-output",
        banyanSourcePath: fieldName,
      },
    );
  }

  const out: TextUnit[] = [];
  for (const compiled of compileUserUnit(input)) {
    for (const split of splitTextUnitByMarkup(compiled)) {
      pushMergedTextUnit(out, split);
    }
  }
  return out;
}

function compileUserUnit(input: unknown): TextUnit[] {
  const unit = normalizeUnitInput(input);
  if (unit == null) {
    return [];
  }
  return compile(unit);
}

function normalizeUnitInput(input: unknown): Unit | null {
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
    default:
      return normalizeTextUnit(raw);
  }
}

function normalizeUnitList(input: unknown): Unit[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item) => normalizeUnitInput(item))
    .filter((item): item is Unit => item != null);
}

function normalizeOptionalUnit(input: unknown): Unit | undefined {
  if (input == null) {
    return undefined;
  }
  return normalizeUnitInput(input) ?? undefined;
}

function normalizeTextCaseForm(form: unknown): TextCaseForm | undefined {
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

function normalizeStringArray(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }

  const values = input.map((item) => String(item ?? "")).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function normalizeRenderStyle(input: unknown): RenderStyle {
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
  if (typeof raw.link === "string") out.link = raw.link;
  if (typeof raw.color === "string") out.color = raw.color;
  if (typeof raw.backgroundColor === "string") {
    out.backgroundColor = raw.backgroundColor;
  }
  return out;
}

function normalizeTextUnit(input: Record<string, unknown>): TextUnit {
  const value = normalizeTextValue(input.value);
  const out: TextUnit = { value };
  if (typeof input.italic === "boolean") out.italic = input.italic;
  if (typeof input.bold === "boolean") out.bold = input.bold;
  if (input.script === "superscript" || input.script === "subscript") {
    out.script = input.script;
  }
  if (typeof input.link === "string") out.link = input.link;
  if (typeof input.color === "string") out.color = input.color;
  if (typeof input.backgroundColor === "string") {
    out.backgroundColor = input.backgroundColor;
  }
  return out;
}

function splitTextUnitByMarkup(base: TextUnit): TextUnit[] {
  const text = base.value ?? "";
  if (!looksLikeMarkup(text)) {
    return [{ ...base, value: decodeEntities(text) }];
  }

  const { value: _ignoredValue, ...styleBase } = base;
  const out: TextUnit[] = [];

  const root = parseHTMLContainer(text);
  if (!root) {
    return [{ ...base, value: decodeEntities(text) }];
  }

  const walk = (node: Node, style: Omit<TextUnit, "value">) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue || "";
      if (!value) return;
      const unit: TextUnit = {
        ...(styleBase as Omit<TextUnit, "value">),
        ...style,
        value,
      };
      pushMergedTextUnit(out, unit);
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === "br") {
      const unit: TextUnit = {
        ...(styleBase as Omit<TextUnit, "value">),
        ...style,
        value: "\n",
      };
      pushMergedTextUnit(out, unit);
      return;
    }

    const nextStyle = { ...style };
    applyStylePatchFromElement(nextStyle, el);
    for (const child of Array.from(el.childNodes)) {
      if (child) walk(child, nextStyle);
    }
  };

  for (const child of Array.from(root.childNodes)) {
    if (child) walk(child, {});
  }

  if (!out.length) {
    return [{ ...base, value: root.textContent || "" }];
  }
  return out;
}

function looksLikeMarkup(text: string): boolean {
  return /<\/?(?:b|strong|i|em|sup|sub|a|span|br)\b/i.test(text);
}

function applyStylePatchFromElement(
  style: Omit<TextUnit, "value">,
  el: Element,
): void {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case "b":
    case "strong":
      style.bold = true;
      break;
    case "i":
    case "em":
      style.italic = true;
      break;
    case "sup":
      style.script = "superscript";
      break;
    case "sub":
      style.script = "subscript";
      break;
    case "a": {
      const href = (el.getAttribute("href") || "").trim();
      if (href) style.link = href;
      break;
    }
    case "span": {
      const styleText = el.getAttribute("style") || "";
      const color = extractCssValue(styleText, "color");
      const bg =
        extractCssValue(styleText, "background-color") ||
        extractCssValue(styleText, "background");
      if (color) style.color = color;
      if (bg) style.backgroundColor = bg;
      break;
    }
    default:
      break;
  }
}

function extractCssValue(styleText: string, prop: string): string | undefined {
  const re = new RegExp(`${prop}\\s*:\\s*([^;]+)`, "i");
  const m = styleText.match(re);
  return m ? m[1].trim() : undefined;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");
}

function pushMergedTextUnit(out: TextUnit[], unit: TextUnit): void {
  if (!unit.value) return;
  const last = out[out.length - 1];
  if (!last) {
    out.push(unit);
    return;
  }
  if (
    last.bold === unit.bold &&
    last.italic === unit.italic &&
    last.script === unit.script &&
    last.link === unit.link &&
    last.color === unit.color &&
    last.backgroundColor === unit.backgroundColor
  ) {
    last.value += unit.value;
    return;
  }
  out.push(unit);
}

/** Ensure INFO exists and generate is callable; emit soft hints */
function validateStyle(style: Style): void {
  const INFO = style.INFO;
  if (!INFO) throw new Error("Style script must define INFO object.");
  if (typeof style.generate !== "function")
    throw new Error(
      "Style script must define function generate (either as a top-level function `function generate() {}` or as `style.generate`).",
    );

  try {
    const hasId = Object.prototype.hasOwnProperty.call(INFO, "id");
    const hasTitle = Object.prototype.hasOwnProperty.call(INFO, "title");
    const hasUpdated = Object.prototype.hasOwnProperty.call(INFO, "updated");
    if (!(hasId && hasTitle && hasUpdated)) {
      ztoolkit.log(
        "Suggest to provide id/title/updated fields in INFO object for better indexing and display.",
      );
    }
  } catch {
    // ignore soft hint errors
  }
}

/** Normalize COMPONENT definition to an array<StyleComponent> */
function normalizeComponents(
  raw: unknown,
  host: Record<string, unknown>,
  scope: "cite" | "citation",
): CiteStyleComponent[] | CitationStyleComponent[] | undefined {
  if (!raw) return undefined;
  const utils = Zotero.getMainWindow().Cu;
  let cmp: unknown;
  try {
    cmp = utils.waiveXrays ? utils.waiveXrays(raw) : raw;
  } catch {
    cmp = raw;
  }
  // Accept array or object map
  let arr: unknown[] | undefined;
  if (Array.isArray(cmp)) arr = cmp;
  else if (cmp && typeof cmp === "object") arr = Object.values(cmp);
  if (!arr || !arr.length) return undefined;

  // Shallow-clone into host and basic shape validation
  const out: Array<CiteStyleComponent | CitationStyleComponent> = [];
  for (const [index, item] of arr.entries()) {
    if (!item || typeof item !== "object") continue;
    const itemRecord = item as Record<string, unknown>;
    const id = String(itemRecord.id || "").trim();
    const type = String(itemRecord.type || "").trim();
    const label = String(itemRecord.label || id || "").trim();
    if (!id || !type) {
      ztoolkit.log(
        `[sandbox] skip invalid UI component: scope=${scope}, index=${index}, id=${String(itemRecord.id ?? "")}, type=${String(itemRecord.type ?? "")}`,
      );
      continue;
    }

    const itemType =
      scope === "cite" && Array.isArray(itemRecord.itemType)
        ? itemRecord.itemType
            .map((v: unknown) => String(v ?? "").trim())
            .filter(Boolean)
        : undefined;

    const componentBase = {
      id,
      label,
      ...(scope === "cite" && itemType?.length ? { itemType } : {}),
    };

    let cloned: CiteStyleComponent | CitationStyleComponent;
    if (type === "checkbox") {
      let value: boolean;
      if (typeof itemRecord.value === "boolean") value = itemRecord.value;
      else if (typeof itemRecord.value === "string")
        value = itemRecord.value.toLowerCase() === "true";
      else value = Boolean(itemRecord.value);
      cloned = { ...componentBase, type, value };
    } else if (type === "text") {
      const value =
        typeof itemRecord.value === "string"
          ? itemRecord.value
          : String(itemRecord.value ?? "");
      const rawData =
        itemRecord.data && typeof itemRecord.data === "object"
          ? (itemRecord.data as Record<string, unknown>)
          : undefined;
      const data =
        rawData && typeof rawData.placeholder === "string"
          ? { placeholder: rawData.placeholder }
          : undefined;
      cloned = { ...componentBase, type, value };
      if (data) cloned.data = data;
    } else if (type === "select") {
      const value =
        typeof itemRecord.value === "string"
          ? itemRecord.value
          : String(itemRecord.value ?? "");
      const rawData =
        itemRecord.data && typeof itemRecord.data === "object"
          ? (itemRecord.data as Record<string, unknown>)
          : undefined;
      const normalizedData = Object.fromEntries(
        Object.entries(rawData ?? {}).map(([optionValue, optionLabel]) => [
          optionValue,
          String(optionLabel ?? ""),
        ]),
      );
      const firstOptionValue = Object.keys(normalizedData)[0] || "";
      const resolvedValue = value || firstOptionValue;
      const data = normalizedData;
      cloned = { ...componentBase, type, value: resolvedValue, data };
    } else {
      continue;
    }

    try {
      const clonedInto = Cu.cloneInto ? Cu.cloneInto(cloned, host) : cloned;
      out.push(clonedInto as CiteStyleComponent | CitationStyleComponent);
    } catch {
      out.push(cloned as CiteStyleComponent | CitationStyleComponent);
    }
  }
  if (!out.length) return undefined;
  return scope === "cite"
    ? (out as CiteStyleComponent[])
    : (out as CitationStyleComponent[]);
}

function installUtilities(sandbox: SandboxGlobal, Cu: SandboxCu): void {
  const hostBridge = (
    Cu.createObjectIn ? Cu.createObjectIn(sandbox) : {}
  ) as Record<string, unknown>;

  for (const [name, fn] of Object.entries(
    createHostUtilityHandlers(sandbox, Cu),
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

function installContextViewRuntime(
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

function createHostUtilityHandlers(
  sandbox: SandboxGlobal,
  Cu: SandboxCu,
): Record<string, UnknownArgsFunction> {
  const handlers: Record<string, UnknownArgsFunction> = {};

  for (const name of RUNTIME_UTILITY_NAMES) {
    const buildHostHandler = UTILITY_DEFINITIONS[name].buildHostHandler;
    if (!buildHostHandler) {
      continue;
    }
    handlers[name] = buildHostHandler(sandbox, Cu);
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

function resolvePath(path: string) {
  const dataDir = Zotero.DataDirectory.dir;
  const banyanDir = PathUtils.join(dataDir, "banyan");
  if (typeof path !== "string" || !path.trim()) {
    throw new Error("Invalid path to resolve");
  }
  const isAbs =
    /^[a-zA-Z]:/.test(path) || path.startsWith("/") || path.startsWith("\\");
  const candidate = isAbs ? path : PathUtils.join(banyanDir, path);
  // 先规范化，再检验是否仍位于 banyan 目录内（防止路径穿越/绝对路径绕过）
  const normalized = PathUtils.normalize(candidate);
  const inBanyan =
    normalized === banyanDir ||
    normalized.startsWith(banyanDir + "\\") ||
    normalized.startsWith(banyanDir + "/");
  if (!inBanyan) {
    throw new Error("Only files in banyan data directory are allowed");
  }
  return normalized;
}

// IOUtils.read(path, options?) → Uint8Array
async function readBytes(
  relPath: string,
  options?: ReadOptions,
): Promise<Uint8Array> {
  return IOUtils.read(resolvePath(relPath), options);
}
// IOUtils.readText(path, options?)
async function readText(
  relPath: string,
  options?: ReadUTF8Options,
): Promise<string> {
  return IOUtils.readUTF8(resolvePath(relPath), options);
}
// IOUtils.readJSON(path, options?)
async function readJSON<T = unknown>(
  relPath: string,
  options?: ReadUTF8Options,
): Promise<T> {
  return IOUtils.readJSON(resolvePath(relPath), options);
}

async function resolveStyleItem<T extends Item>(
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
    sourceItem: zoteroItem ? (toBanyanItem(zoteroItem) as T) : item,
    zoteroItem: zoteroItem ?? undefined,
  };
}

async function readMultilingualItemsForStyle<T extends Item>(
  item: T,
): Promise<T[]> {
  const { zoteroItem } = await resolveStyleItem(item);
  if (!zoteroItem) {
    return [];
  }

  const relatedItems = await getRelatedMultilingualItems(zoteroItem);
  return relatedItems.map((relatedItem) => toBanyanItem(relatedItem) as T);
}

async function readMultilingualItemForStyle<T extends Item>(
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

const HTML_ROOT_ID = "__banyan_html_root__";

function parseHTMLContainer(input: string): HTMLElement | null {
  try {
    const DOMParserCtor =
      (ztoolkit.getGlobal("DOMParser") as (new () => DOMParser) | undefined) ||
      (typeof DOMParser === "function" ? DOMParser : undefined);
    if (!DOMParserCtor) return null;
    const parser = new DOMParserCtor();
    const doc = parser.parseFromString(
      `<div id="${HTML_ROOT_ID}">${input}</div>`,
      "text/html",
    );
    return doc.getElementById(HTML_ROOT_ID) as HTMLElement | null;
  } catch {
    return null;
  }
}
