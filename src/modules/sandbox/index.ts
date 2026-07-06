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
  CitationStyleComponent,
  CiteStyleComponent,
  CitationContext,
  Style,
  StyleResult,
} from "../../../typings/style";
import {
  activateGenerateDebugBudget as activateSandboxGenerateDebugBudget,
  createStyleDebugContext,
  installContextViewRuntime as installSandboxContextViewRuntime,
  installSandboxContexts as installRuntimeSandboxContexts,
  installUtilities as installSandboxUtilities,
  RUNTIME_UTILITY_NAMES,
  withGenerateDebugBudget as withSandboxGenerateDebugBudget,
} from "../sandboxUtils";
import type { SandboxCu, SandboxGlobal, StyleDebugSink } from "../sandboxUtils";
export type { SandboxCu, SandboxGlobal, StyleDebugSink } from "../sandboxUtils";
import {
  normalizeGenerateResult,
  normalizeStyleCitationType,
} from "./outputNormalization";
import { normalizeComponents } from "./styleComponents";
import {
  createBanyanRuntimeError,
  createGenerateTimeoutError,
  GENERATE_TIMEOUT_MS,
  inheritSandboxErrorMetadata,
  toHostGenerateError,
  withGenerateTimeout,
  type SandboxScriptError,
} from "./runtimeErrors";
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
export type CreateStyleOptions = {
  debugSink?: StyleDebugSink;
};

export type CallbackStyle = Style & {
  __banyanGenerateWithCallbacks?: (
    contexts: CitationContext[],
    callbacks: StyleGenerateCallbacks,
  ) => void;
};
let generateBridgeInvocationSequence = 0;

/**
 * Names the sandbox must export. Defined once; wrapper and extraction
 * are both generated from this list — no manual string duplication.
 */
const STYLE_EXPORTS = ["INFO", "generate", "UI"] as const;

export async function createStyle(
  code: string,
  options: CreateStyleOptions = {},
): Promise<Style> {
  // 1) Build sandbox and evaluate user code
  const debugContext = createStyleDebugContext(options.debugSink);
  const sandbox = buildSandbox(debugContext);
  const exports = evalAndExtract(code, sandbox);

  // 2) Bridge values across compartments and normalize
  const bridged = bridgeAndNormalize(exports, sandbox, debugContext);

  // 3) Final validation and soft hints
  validateStyle(bridged);

  return bridged;
}

/** Build the restricted sandbox */

function buildSandbox(
  debugContext: ReturnType<typeof createStyleDebugContext>,
): SandboxGlobal {
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
  sandbox.console = {
    log: () => undefined,
    error: (...args: unknown[]) =>
      ztoolkit.logError(
        `[sandbox] style-console.error ${args.map((arg) => String(arg)).join(" ")}`,
      ),
  };
  installSandboxUtilities(sandbox, Cu, debugContext);
  installSandboxContextViewRuntime(sandbox, Cu);

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
        ztoolkit.logError(`[sandbox] builtin.overwritten key=${key}`);
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
  debugContext: ReturnType<typeof createStyleDebugContext>,
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
    try {
      // Inject contexts as a readonly global with safe fallback for missing fields.
      installRuntimeSandboxContexts(contexts, sandbox, Cu);

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

      const out = await withSandboxGenerateDebugBudget(debugContext, () =>
        withGenerateTimeout(
          Promise.resolve((generateRaw as () => Promise<unknown> | unknown)()),
          styleName,
        ),
      );
      return normalizeOut(out);
    } catch (e) {
      ztoolkit.logError(e);
      throw e;
    }
  };

  const generateWithCallbacks = (
    contexts: CitationContext[],
    callbacks: StyleGenerateCallbacks,
  ): void => {
    try {
      // Inject contexts as a readonly global with safe fallback for missing fields.
      installRuntimeSandboxContexts(contexts, sandbox, Cu);

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
        ztoolkit.logError(e);
        callbacks.reject(e);
      };

      try {
        let settled = false;
        const restoreDebugBudget =
          activateSandboxGenerateDebugBudget(debugContext);
        const settle = (action: () => void): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          try {
            action();
          } finally {
            restoreDebugBudget();
          }
        };
        const timeout = setTimeout(() => {
          settle(() => rejectGenerate(createGenerateTimeoutError(styleName)));
        }, GENERATE_TIMEOUT_MS);

        try {
          (generateRaw as GenerateBridgeInvoker)({
            resolve: (out) => {
              settle(() => {
                try {
                  callbacks.resolve(normalizeOut(out));
                } catch (error) {
                  rejectGenerate(error);
                }
              });
            },
            reject: (error) => {
              settle(() => rejectGenerate(error));
            },
          });
        } catch (error) {
          settle(() => rejectGenerate(error));
        }
      } catch (error) {
        rejectGenerate(error);
      }
    } catch (e) {
      ztoolkit.logError(e);
      callbacks.reject(e);
    }
  };

  const bridged = { INFO, generate } as CallbackStyle;
  bridged.__banyanGenerateWithCallbacks = generateWithCallbacks;
  if (UI) bridged.UI = UI;
  return bridged;
}

export function cloneValueWithMaintainedAPI<T>(value: T): T {
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
    void hasId;
    void hasTitle;
    void hasUpdated;
  } catch {
    // ignore soft hint errors
  }
}
