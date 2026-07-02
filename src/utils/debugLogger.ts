import { getPref } from "./prefs";

type DebugLogLevel = "INFO" | "ERROR";

type DebugLogEntry = {
  timestamp: string;
  level: DebugLogLevel;
  module: string;
  event: string;
  detail?: unknown;
  error?: unknown;
};

type DebugModuleLogger = {
  log: (event: string, detail?: unknown) => void;
  error: (event: string, error?: unknown, detail?: unknown) => void;
};

const DEBUG_LOGGING_ENABLED_PREF = "debugLoggingEnabled" as const;
const DEBUG_LOGGING_MODULES_PREF = "debugLoggingModules" as const;
const DEBUG_LOGGING_DESKTOP_AUTO_EXPORT_PREF =
  "debugLoggingDesktopAutoExport" as const;
const MAX_BUFFERED_LOG_ENTRIES = 1000;

function formatTimestamp(date = new Date()): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return (
    [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join(
      "-",
    ) +
    " " +
    [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(
      ":",
    ) +
    "." +
    pad(date.getMilliseconds(), 3)
  );
}

function buildSessionStamp(date = new Date()): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function getDesktopDir(): string {
  try {
    const desktop = Services.dirsvc.get("Desk", Ci.nsIFile);
    return desktop.path;
  } catch {
    return PathUtils.tempDir;
  }
}

function normalizeValue(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (depth > 12) {
    return `[MaxDepth:${Object.prototype.toString.call(value)}]`;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }

  if (typeof value === "symbol") {
    return String(value);
  }

  if (typeof value === "function") {
    const fn = value as Function;
    return `[Function ${fn.name || "anonymous"}]`;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: normalizeValue(
        (value as Error & { cause?: unknown }).cause,
        seen,
        depth + 1,
      ),
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item, seen, depth + 1));
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) {
      return "[Circular]";
    }
    seen.add(obj);

    const tag = Object.prototype.toString.call(obj);
    const out: Record<string, unknown> =
      tag === "[object Object]" ? {} : { tag };

    for (const [key, item] of Object.entries(obj)) {
      out[key] = normalizeValue(item, seen, depth + 1);
    }

    seen.delete(obj);
    return out;
  }

  return String(value);
}

function serializeValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  const normalized = normalizeValue(value);
  if (typeof normalized === "string") {
    return normalized;
  }

  try {
    return JSON.stringify(normalized);
  } catch {
    return String(normalized);
  }
}

function isDevelopmentEnv(): boolean {
  try {
    return addon.data.env === "development";
  } catch {
    return false;
  }
}

function isDebugLoggingEnabled(): boolean {
  try {
    return Boolean(getPref(DEBUG_LOGGING_ENABLED_PREF));
  } catch {
    return false;
  }
}

function getEnabledDebugModules(): string[] {
  try {
    return String(getPref(DEBUG_LOGGING_MODULES_PREF) || "")
      .split(/[,\s]+/)
      .map((part) => part.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function shouldCaptureModule(moduleName: string): boolean {
  if (!isDevelopmentEnv() || !isDebugLoggingEnabled()) {
    return false;
  }

  const enabledModules = getEnabledDebugModules();
  if (enabledModules.length === 0) {
    return true;
  }

  return enabledModules.some((pattern) => {
    if (pattern === "*") {
      return true;
    }
    if (pattern.endsWith(".*")) {
      const prefix = pattern.slice(0, -2);
      return moduleName === prefix || moduleName.startsWith(`${prefix}.`);
    }
    return moduleName === pattern;
  });
}

function shouldAutoExportToDesktop(): boolean {
  try {
    return Boolean(getPref(DEBUG_LOGGING_DESKTOP_AUTO_EXPORT_PREF));
  } catch {
    return false;
  }
}

export class DebugLogger {
  private readonly sessionStamp = buildSessionStamp();
  private readonly entries: DebugLogEntry[] = [];
  private pendingWrites: Promise<void> = Promise.resolve();

  private buildEntry(
    level: DebugLogLevel,
    module: string,
    event: string,
    error?: unknown,
    detail?: unknown,
  ): DebugLogEntry {
    return {
      timestamp: formatTimestamp(),
      level,
      module,
      event,
      error: error === undefined ? undefined : normalizeValue(error),
      detail: detail === undefined ? undefined : normalizeValue(detail),
    };
  }

  private pushEntry(entry: DebugLogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_BUFFERED_LOG_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_BUFFERED_LOG_ENTRIES);
    }

    if (shouldAutoExportToDesktop()) {
      void this.appendEntryToDesktop(entry);
    }
  }

  private formatEntry(entry: DebugLogEntry): string {
    const parts = [
      `[${entry.timestamp}]`,
      `[${entry.level}]`,
      `[${entry.module}]`,
      entry.event,
    ];

    if (entry.detail !== undefined) {
      parts.push(`detail=${serializeValue(entry.detail)}`);
    }
    if (entry.error !== undefined) {
      parts.push(`error=${serializeValue(entry.error)}`);
    }

    return `${parts.join(" ")}\n`;
  }

  private getDesktopLogPath(): string {
    return PathUtils.join(
      getDesktopDir(),
      `Banyan-debug-${this.sessionStamp}.log`,
    );
  }

  private async appendEntryToDesktop(entry: DebugLogEntry): Promise<void> {
    const path = this.getDesktopLogPath();
    const text = this.formatEntry(entry);
    this.pendingWrites = this.pendingWrites
      .then(async () => {
        const writeUTF8WithAppend = IOUtils.writeUTF8 as unknown as (
          filePath: string,
          data: string,
          options?: { mode?: "append" },
        ) => Promise<void>;
        await writeUTF8WithAppend(path, text, { mode: "append" });
      })
      .catch((error) => {
        ztoolkit.logError(error);
      });
    await this.pendingWrites;
  }

  log(module: string, event: string, detail?: unknown): void {
    if (!shouldCaptureModule(module)) {
      return;
    }

    this.pushEntry(this.buildEntry("INFO", module, event, undefined, detail));
  }

  error(
    module: string,
    event: string,
    error?: unknown,
    detail?: unknown,
  ): void {
    if (error instanceof Error) {
      ztoolkit.logError(error);
    } else if (error !== undefined) {
      ztoolkit.logError(`${module}.${event}: ${serializeValue(error)}`);
    } else {
      ztoolkit.logError(`${module}.${event}`);
    }

    if (!shouldCaptureModule(module)) {
      return;
    }

    this.pushEntry(this.buildEntry("ERROR", module, event, error, detail));
  }

  clear(): void {
    this.entries.length = 0;
  }

  getEntries(): DebugLogEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  async exportToDesktop(fileName?: string): Promise<string> {
    const path = fileName
      ? PathUtils.join(getDesktopDir(), fileName)
      : this.getDesktopLogPath();
    const header = [
      `==== Banyan debug export ====`,
      `createdAt=${formatTimestamp()}`,
      `entries=${this.entries.length}`,
      "",
    ].join("\n");
    const body = this.entries.map((entry) => this.formatEntry(entry)).join("");
    await IOUtils.writeUTF8(path, `${header}${body}`);
    return path;
  }
}

export const debugLogger = new DebugLogger();

export function createModuleLogger(moduleName: string): DebugModuleLogger {
  return {
    log(event: string, detail?: unknown) {
      debugLogger.log(moduleName, event, detail);
    },
    error(event: string, error?: unknown, detail?: unknown) {
      debugLogger.error(moduleName, event, error, detail);
    },
  };
}

export async function exportDebugLogsToDesktop(
  fileName?: string,
): Promise<string> {
  return debugLogger.exportToDesktop(fileName);
}

export function clearDebugLogs(): void {
  debugLogger.clear();
}
