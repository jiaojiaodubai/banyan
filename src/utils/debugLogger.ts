type LogLevel = "INFO" | "ERROR";

type XpcomClassEntry = {
  createInstance: <T>(iid: T) => nsQIResult<T>;
};

type LegacyLocalFile = {
  initWithPath(path: string): void;
};

type LegacyFileOutputStream = {
  init(
    file: unknown,
    ioFlags: number,
    perm: number,
    behaviorFlags: number,
  ): void;
  close(): void;
};

type LegacyConverterOutputStream = {
  init(
    outputStream: unknown,
    charset: string,
    bufferSize: number,
    replacementChar: number,
  ): void;
  writeString(text: string): void;
  close(): void;
};

const FILE_WRITE_ONLY = 0x02;
const FILE_CREATE = 0x08;
const FILE_APPEND = 0x10;
const FILE_DEFAULT_PERMISSIONS = 0o666;

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
    // Fallback to temp directory when desktop path cannot be resolved.
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

  const valueType = typeof value;
  if (
    valueType === "string" ||
    valueType === "number" ||
    valueType === "boolean" ||
    valueType === "bigint"
  ) {
    return value;
  }

  if (valueType === "symbol") {
    return String(value);
  }

  if (valueType === "function") {
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

  if (valueType === "object") {
    const obj = value as Record<string, unknown>;

    if (seen.has(obj)) {
      return "[Circular]";
    }
    seen.add(obj);

    const tag = Object.prototype.toString.call(obj);
    if (typeof (obj as { then?: unknown }).then === "function") {
      seen.delete(obj);
      return { tag, promiseLike: true };
    }

    if (tag !== "[object Object]") {
      const plain: Record<string, unknown> = { tag };
      for (const key of Object.keys(obj)) {
        plain[key] = normalizeValue(obj[key], seen, depth + 1);
      }
      seen.delete(obj);
      return plain;
    }

    const out: Record<string, unknown> = {};
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

export class DebugLogger {
  private readonly logFilePath: string;
  private pendingWrites: Promise<void> = Promise.resolve();
  private sessionHeaderWritten = false;

  constructor(logFilePath?: string) {
    const logFileName = `Banyan-debug-${buildSessionStamp()}.log`;
    this.logFilePath =
      logFilePath || PathUtils.join(getDesktopDir(), logFileName);
  }

  getLogFilePath(): string {
    return this.logFilePath;
  }

  log(...args: unknown[]): void {
    ztoolkit.log(...args);
    this.enqueueWrite(this.formatLogLine("INFO", args));
  }

  logImmediate(...args: unknown[]): void {
    ztoolkit.log(...args);
    this.writeImmediately(this.formatLogLine("INFO", args));
  }

  logError(...args: unknown[]): void {
    ztoolkit.log("[debug:error]", ...args);

    const firstErrorArg = args.find((arg) => arg instanceof Error);
    if (firstErrorArg instanceof Error) {
      ztoolkit.logError(firstErrorArg);
    } else {
      ztoolkit.logError(args.map((arg) => serializeValue(arg)).join(" "));
    }

    this.enqueueWrite(this.formatLogLine("ERROR", args));
  }

  logErrorImmediate(...args: unknown[]): void {
    ztoolkit.log("[debug:error]", ...args);

    const firstErrorArg = args.find((arg) => arg instanceof Error);
    if (firstErrorArg instanceof Error) {
      ztoolkit.logError(firstErrorArg);
    } else {
      ztoolkit.logError(args.map((arg) => serializeValue(arg)).join(" "));
    }

    this.writeImmediately(this.formatLogLine("ERROR", args));
  }

  writeFile(text: string): Promise<void> {
    return this.enqueueWrite(text.endsWith("\n") ? text : `${text}\n`);
  }

  private formatLogLine(level: LogLevel, args: unknown[]): string {
    const serializedArgs = args.map((arg) => serializeValue(arg)).join(" ");
    return `[${formatTimestamp()}] [${level}] ${serializedArgs}\n`;
  }

  private enqueueWrite(text: string): Promise<void> {
    this.pendingWrites = this.pendingWrites
      .then(async () => {
        if (!this.sessionHeaderWritten) {
          this.sessionHeaderWritten = true;
          await this.appendText(
            `==== Banyan debug session started at ${formatTimestamp()} ====\n` +
              `logFile=${this.logFilePath}\n`,
          );
        }
        await this.appendText(text);
      })
      .catch((error) => {
        try {
          ztoolkit.logError(error);
        } catch {
          // ignore logging failure
        }
      });
    return this.pendingWrites;
  }

  private writeImmediately(text: string): void {
    try {
      this.ensureSessionHeaderWrittenSync();
      this.appendTextSync(text);
    } catch (error) {
      try {
        ztoolkit.logError(error);
      } catch {
        // ignore logging failure
      }
    }
  }

  private ensureSessionHeaderWrittenSync(): void {
    if (this.sessionHeaderWritten) {
      return;
    }

    this.sessionHeaderWritten = true;
    this.appendTextSync(
      `==== Banyan debug session started at ${formatTimestamp()} ====\n` +
        `logFile=${this.logFilePath}\n`,
    );
  }

  private async appendText(text: string): Promise<void> {
    try {
      if (!(await IOUtils.exists(this.logFilePath))) {
        // Create file if not exists
        await IOUtils.writeUTF8(this.logFilePath, "");
      }
    } catch {
      // ignore exists/create error
    }
    const writeUTF8WithAppend = IOUtils.writeUTF8 as unknown as (
      path: string,
      data: string,
      options?: { mode?: "append" },
    ) => Promise<void>;
    await writeUTF8WithAppend(this.logFilePath, text, { mode: "append" });
  }

  private appendTextSync(text: string): void {
    const Cc = Components.classes as unknown as Record<string, XpcomClassEntry>;
    const Ci = Components.interfaces;

    const localFile = Cc["@mozilla.org/file/local;1"].createInstance(
      Ci.nsIFile,
    ) as unknown as LegacyLocalFile;
    localFile.initWithPath(this.logFilePath);

    const outputStream = Cc[
      "@mozilla.org/network/file-output-stream;1"
    ].createInstance(
      Ci.nsIFileOutputStream,
    ) as unknown as LegacyFileOutputStream;
    outputStream.init(
      localFile,
      FILE_WRITE_ONLY | FILE_CREATE | FILE_APPEND,
      FILE_DEFAULT_PERMISSIONS,
      0,
    );

    const converterStream = Cc[
      "@mozilla.org/intl/converter-output-stream;1"
    ].createInstance(
      Ci.nsIConverterOutputStream,
    ) as unknown as LegacyConverterOutputStream;

    try {
      converterStream.init(outputStream, "UTF-8", 0, 0);
      converterStream.writeString(text);
    } finally {
      try {
        converterStream.close();
      } catch {
        try {
          outputStream.close();
        } catch {
          // ignore close failure
        }
      }
    }
  }
}

export const debugLogger = new DebugLogger();
