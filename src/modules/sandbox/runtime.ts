/**
 * Gecko sandbox primitives for the core (`SandboxRuntime`).
 *
 * The host policy lives here: a null principal, no privileged globals, and the
 * compartment semantics the plugin has always used (`wantXrays: false`, so
 * callables on returned objects stay reachable from the host). The core never
 * sees any of it.
 *
 * References:
 * - Xray vision: https://developer.mozilla.org/en-US/docs/Xray_vision
 * - Components.utils.Sandbox:
 *   https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Language_Bindings/Components.utils.Sandbox
 * - cloneInto/exportFunction:
 *   https://developer.mozilla.org/en-US/docs/Mozilla/JavaScript_code_modules/XPCOMUtils.jsm#Cross-Compartment_wrappers
 */
import type {
  EvaluateOptions,
  SandboxContext,
  SandboxRuntime,
} from "@banyan/core/host";
import { createBanyanRuntimeError } from "@banyan/core/sandbox/runtimeErrors";

type SandboxGlobal = Record<string, unknown>;

/** `Cu` as this plugin uses it (the shape `zotero-types` declares). */
type SandboxCu = nsXPCComponents_Utils & nsIXPCComponents_Utils;

/** Destination compartment for `cloneInto` when bringing values to the host. */
const HOST_REALM_SCOPE: Record<string, unknown> = {};

function getCu(): SandboxCu {
  return Cu;
}

/** Host value -> sandbox value, via a structured clone plus `cloneInto`. */
function cloneValueWithMaintainedAPI<T>(value: T): T {
  const hostStructuredClone =
    (typeof globalThis.structuredClone === "function"
      ? globalThis.structuredClone
      : undefined) ||
    (ztoolkit.getGlobal("structuredClone") as
      ((input: unknown) => unknown) | undefined);

  if (typeof hostStructuredClone !== "function") {
    throw createBanyanRuntimeError(
      "structuredClone is unavailable in host environment.",
      { code: "host-capability" },
    );
  }

  return hostStructuredClone(value) as T;
}

function buildSandbox(): SandboxGlobal {
  const principal = Services.scriptSecurityManager.createNullPrincipal({});
  const sandbox = Cu.Sandbox(principal, {
    sandboxName: "Banyan:StyleSandbox",
    wantXrays: false,
    wantComponents: false,
  }) as unknown as SandboxGlobal;

  // The core installs the `console` exposed to styles; a second one here would
  // make the two environments behave differently.

  // Explicitly deny dangerous capabilities.
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

class GeckoSandboxContext implements SandboxContext {
  constructor(private readonly sandbox: SandboxGlobal) {}

  evaluate(source: string, options?: EvaluateOptions): unknown {
    return Cu.evalInSandbox(
      source,
      this.sandbox,
      "1.8",
      options?.filename ?? "banyan-style.js",
      1,
    );
  }

  defineGlobal(name: string, value: unknown): void {
    // The style console is part of the core's stable contract: a style may
    // read it, but must not replace it with a sink of its own. The core's
    // utility table installs its own non-writable globals; `console` arrives
    // through this primitive, so the host makes that one binding final.
    if (name === "console") {
      Object.defineProperty(this.sandbox, name, {
        value,
        writable: false,
        configurable: false,
        enumerable: true,
      });
      return;
    }
    this.sandbox[name] = value;
  }

  readGlobal(name: string): unknown {
    return this.sandbox[name];
  }

  deleteGlobal(name: string): void {
    try {
      delete this.sandbox[name];
    } catch {
      // ignore cleanup failure
    }
  }

  createObject(): Record<string, unknown> {
    const utils = getCu();
    if (typeof utils.createObjectIn !== "function") {
      throw createBanyanRuntimeError(
        "Banyan style sandbox requires Cu.createObjectIn to create context-owned objects.",
        { code: "host-capability" },
      );
    }
    return utils.createObjectIn(this.sandbox) as Record<string, unknown>;
  }

  defineFunction(
    target: Record<string, unknown>,
    name: string,
    fn: (...args: unknown[]) => unknown,
  ): void {
    const utils = getCu();
    if (typeof utils.exportFunction !== "function") {
      throw createBanyanRuntimeError(
        "Banyan style sandbox requires Cu.exportFunction to expose host callables.",
        { code: "host-capability" },
      );
    }
    utils.exportFunction(fn, target, { defineAs: name });
  }

  importValue<T>(value: T): T {
    const utils = getCu();
    if (typeof utils.cloneInto !== "function") {
      throw createBanyanRuntimeError(
        "cloneInto is unavailable in sandbox host environment.",
        { code: "host-capability" },
      );
    }
    return utils.cloneInto(cloneValueWithMaintainedAPI(value), this.sandbox, {
      cloneFunctions: false,
    }) as T;
  }

  /**
   * Read a sandbox value: unwrap Xrays so plain property reads work. No copy,
   * so functions stay callable.
   */
  exportValue<T>(value: T): T {
    const utils = getCu();
    try {
      if (typeof utils.waiveXrays === "function") {
        return utils.waiveXrays(value) as T;
      }
    } catch {
      // fall back to the original value
    }
    return value;
  }

  /**
   * Sandbox value -> host value: unwrap Xrays, then clone into the host realm,
   * so plugin code never holds a sandbox-realm object (Zotero APIs and the
   * structured clone used elsewhere would both choke on one). Data only.
   */
  cloneToHost<T>(value: T): T {
    const utils = getCu();
    let source = value;
    try {
      if (typeof utils.waiveXrays === "function") {
        source = utils.waiveXrays(value) as T;
      }
    } catch {
      // fall back to the original value
    }

    if (
      !source ||
      typeof source !== "object" ||
      typeof utils.cloneInto !== "function"
    ) {
      return source;
    }

    try {
      return utils.cloneInto(source, HOST_REALM_SCOPE, {
        cloneFunctions: false,
      }) as T;
    } catch {
      return source;
    }
  }

  /**
   * Gecko clones cross-compartment values on a host task; the style bridge
   * relies on that to keep the Promise in the host realm (MDN advises against
   * cloning Promise objects across realms).
   */
  deferHostTask(callback: () => void): void {
    const runnable = { run: callback };
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

    setTimeout(runnable.run, 0);
  }
}

export const geckoSandboxRuntime: SandboxRuntime = {
  createContext(): SandboxContext {
    return new GeckoSandboxContext(buildSandbox());
  },
};
