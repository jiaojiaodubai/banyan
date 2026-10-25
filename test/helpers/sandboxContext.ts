import type { SandboxContext } from "@banyan/core/host";

/**
 * Identity sandbox context for tests: values cross unchanged and callbacks run
 * inline. Validators only need this interface, so no host stub is required.
 */
export function createIdentitySandboxContext(
  evaluate?: (source: string) => unknown,
): SandboxContext {
  const globals = new Map<string, unknown>();
  return {
    evaluate: (source) => evaluate?.(source),
    defineGlobal: (name, value) => {
      globals.set(name, value);
    },
    readGlobal: (name) => globals.get(name),
    deleteGlobal: (name) => {
      globals.delete(name);
    },
    createObject: () => ({}),
    defineFunction: (target, name, fn) => {
      (target as Record<string, unknown>)[name] = fn;
    },
    deferHostTask: (callback) => callback(),
    importValue: (value) => value,
    exportValue: (value) => value,
    cloneToHost: (value) => value,
  };
}
