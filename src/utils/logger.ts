/**
 * Plugin logging: one leveled facade over Zotero's output channels.
 *
 * The levels describe what a message means, not where it goes:
 *
 * - `debug` — step traces that help while working on a feature (per-item
 *   progress, resolved paths, ignored input).
 * - `info` — something noteworthy happened and it is not a problem (a style was
 *   reloaded, a server started).
 * - `warn` — the plugin keeps going, but something was missing, unsupported or
 *   ignored.
 * - `error` — an operation failed. Pass the `Error` when there is one so its
 *   stack reaches Zotero's debug output.
 *
 * `debug` and `info` share Zotero's debug output (`[Banyan]` prefixed, mirrored
 * to the console in development builds); `warn` and `error` also reach Zotero's
 * error console, which is where a user or a maintainer looks when something is
 * wrong.
 *
 * `createLogger()` binds a module name once, so call sites stay short and the
 * output stays greppable: every line is prefixed with `[module]`.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/** A logger bound to one module; see the module doc for the level meanings. */
export interface Logger {
  debug(message: string, detail?: unknown): void;
  info(message: string, detail?: unknown): void;
  warn(message: string, reason?: unknown, detail?: unknown): void;
  error(message: string, reason?: unknown, detail?: unknown): void;
}

function serialize(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return value.message;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** `[module] message: serialized detail and reason`. */
function compose(
  moduleName: string,
  message: string,
  detail: unknown,
  reason: unknown,
): string {
  let line = `[${moduleName}] ${message}`;
  if (detail !== undefined) {
    line += `: ${serialize(detail)}`;
  }
  if (reason !== undefined) {
    line += `: ${serialize(reason)}`;
  }
  return line;
}

export function createLogger(moduleName: string): Logger {
  const write = (
    level: LogLevel,
    message: string,
    reason: unknown,
    detail: unknown,
  ): void => {
    // Logging must never break the call it reports on, and a missing output
    // channel (a test double, a partially torn-down window) is not the
    // caller's problem.
    try {
      writeLine(moduleName, level, message, reason, detail);
    } catch {
      /* the message is lost, the operation is not */
    }
  };

  return {
    debug: (message, detail) => write("debug", message, undefined, detail),
    info: (message, detail) => write("info", message, undefined, detail),
    warn: (message, reason, detail) => write("warn", message, reason, detail),
    error: (message, reason, detail) => write("error", message, reason, detail),
  };
}

function writeLine(
  moduleName: string,
  level: LogLevel,
  message: string,
  reason: unknown,
  detail: unknown,
): void {
  if (level === "debug" || level === "info") {
    // `ztoolkit.log` writes to Zotero's debug output and, in development
    // builds, to the console.
    ztoolkit.log(compose(moduleName, message, detail, reason));
    return;
  }

  if (level === "warn") {
    // `Zotero.warn` appends a stack of its own call site, which is noise
    // here, so the two halves are written directly instead.
    const line = compose(moduleName, message, detail, reason);
    Zotero.debug(line, 2);
    Zotero.log(line, "warning");
    return;
  }

  if (reason instanceof Error) {
    const context = compose(moduleName, message, detail, undefined);
    Zotero.debug(reason, 1);
    Zotero.log(`${context}: ${reason.message}`, "error");
    return;
  }

  const line = compose(moduleName, message, detail, reason);
  Zotero.debug(line, 1);
  Zotero.log(line, "error");
}
