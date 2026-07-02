export const GENERATE_TIMEOUT_MS = 15 * 60 * 1000;

export type BanyanRuntimeError = Error & {
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
  cause?: unknown;
  banyanPhase?: string;
  banyanSourcePath?: string;
};

export type SandboxScriptError = BanyanRuntimeError & {
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
  cause?: unknown;
};

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function inheritSandboxErrorMetadata(
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

export function createBanyanRuntimeError(
  message: string,
  details?: Partial<BanyanRuntimeError>,
): BanyanRuntimeError {
  const error = new Error(message) as BanyanRuntimeError;
  if (details) {
    Object.assign(error, details);
  }
  return error;
}

export function createGenerateTimeoutError(
  styleName: string,
): BanyanRuntimeError {
  return createBanyanRuntimeError(
    `Style "${styleName}" generate() exceeded ${GENERATE_TIMEOUT_MS / 1000} seconds. Async work may be stuck or waiting forever.`,
    {
      banyanPhase: "generate-timeout",
      banyanSourcePath: "generate()",
    },
  );
}

export function withGenerateTimeout<T>(
  promise: Promise<T>,
  styleName: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(createGenerateTimeoutError(styleName));
    }, GENERATE_TIMEOUT_MS);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function toHostGenerateError(reason: unknown): BanyanRuntimeError {
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
