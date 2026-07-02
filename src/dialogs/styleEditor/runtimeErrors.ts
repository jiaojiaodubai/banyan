const MAX_PREVIEW_ERROR_STACK_LINES = 40;
const MAX_PREVIEW_ERROR_LINES = 120;
const MAX_PREVIEW_ERROR_COPY_LINES = 240;
const MAX_PREVIEW_ERROR_CAUSE_DEPTH = 3;
const SANDBOX_SCRIPT_FILE_BASENAME = "banyan-style.js";
const SANDBOX_SCRIPT_WRAPPER_PREFIX_LINES = 2;
const HOST_COMPILED_SCRIPT_HINT = "/content/scripts/";

type RuntimeErrorInfo = {
  name: string;
  message: string;
  fileName: string | null;
  lineNumber: number | null;
  columnNumber: number | null;
  stack: string | null;
  phase: string | null;
  sourcePath: string | null;
  cause: unknown;
};

export type FormattedRuntimeError = {
  summary: string;
  lines: string[];
  copyText: string;
};

type RuntimeErrorFormatOptions = {
  errorPrefix: string;
};

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function getErrorDebugString(error: unknown): string {
  if (error instanceof Error) {
    const ext = error as Error & {
      fileName?: string;
      lineNumber?: number;
      columnNumber?: number;
      errorCode?: number;
    };
    return JSON.stringify({
      name: ext.name,
      message: ext.message,
      fileName: ext.fileName,
      lineNumber: ext.lineNumber,
      columnNumber: ext.columnNumber,
      errorCode: ext.errorCode,
      stack: ext.stack,
    });
  }
  return getErrorMessage(error);
}

function isSandboxStyleScriptFile(fileName: string | null): boolean {
  if (!fileName) {
    return false;
  }
  return fileName.includes(SANDBOX_SCRIPT_FILE_BASENAME);
}

function isHostCompiledRuntimeFile(fileName: string | null): boolean {
  if (!fileName) {
    return false;
  }
  return fileName.includes(HOST_COMPILED_SCRIPT_HINT);
}

function isHostCompiledRuntimeStackLine(line: string): boolean {
  return line.includes(HOST_COMPILED_SCRIPT_HINT);
}

function toScriptLineNumber(
  fileName: string | null,
  lineNumber: number | null,
): number | null {
  if (!isSandboxStyleScriptFile(fileName) || lineNumber === null) {
    return lineNumber;
  }

  if (lineNumber <= SANDBOX_SCRIPT_WRAPPER_PREFIX_LINES) {
    return lineNumber;
  }

  return lineNumber - SANDBOX_SCRIPT_WRAPPER_PREFIX_LINES;
}

function remapSandboxStackLines(stack: string): string {
  return stack.replace(
    /(banyan-style\.js:)(\d+)(:\d+)/g,
    (_full, prefix: string, rawLine: string, suffix: string) => {
      const parsedLine = Number.parseInt(rawLine, 10);
      if (!Number.isFinite(parsedLine)) {
        return `${prefix}${rawLine}${suffix}`;
      }

      const mapped = toScriptLineNumber(
        SANDBOX_SCRIPT_FILE_BASENAME,
        parsedLine,
      );
      return `${prefix}${mapped ?? parsedLine}${suffix}`;
    },
  );
}

function getDepthIndent(depth: number): string {
  return "  ".repeat(Math.max(depth, 0));
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toRuntimeErrorInfo(error: unknown): RuntimeErrorInfo {
  const raw =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : null;
  const name =
    typeof raw?.name === "string" && raw.name.trim()
      ? raw.name.trim()
      : "Error";
  const message =
    typeof raw?.message === "string" && raw.message.trim()
      ? raw.message
      : getErrorMessage(error);
  const fileName =
    typeof raw?.fileName === "string" && raw.fileName.trim()
      ? raw.fileName
      : null;
  const lineNumber = toScriptLineNumber(
    fileName,
    toNullableNumber(raw?.lineNumber),
  );
  const columnNumber = toNullableNumber(raw?.columnNumber);
  const rawStack =
    typeof raw?.stack === "string" && raw.stack.trim() ? raw.stack : null;
  const stack = rawStack ? remapSandboxStackLines(rawStack) : null;
  const phase =
    typeof raw?.banyanPhase === "string" && raw.banyanPhase.trim()
      ? raw.banyanPhase
      : null;
  const sourcePath =
    typeof raw?.banyanSourcePath === "string" && raw.banyanSourcePath.trim()
      ? raw.banyanSourcePath
      : null;

  return {
    name,
    message,
    fileName,
    lineNumber,
    columnNumber,
    stack,
    phase,
    sourcePath,
    cause: raw?.cause,
  };
}

function formatRuntimeErrorLocation(info: RuntimeErrorInfo): string | null {
  if (isHostCompiledRuntimeFile(info.fileName)) {
    return null;
  }

  const parts: string[] = [];
  if (info.fileName) {
    parts.push(info.fileName);
  }
  if (info.lineNumber !== null) {
    parts.push(`line ${info.lineNumber}`);
  }
  if (info.columnNumber !== null) {
    parts.push(`column ${info.columnNumber}`);
  }
  return parts.length ? parts.join(", ") : null;
}

function getRuntimeStackSections(info: RuntimeErrorInfo): {
  primary: string[];
  internal: string[];
} {
  if (!info.stack) {
    return {
      primary: [],
      internal: [],
    };
  }

  const lines = info.stack
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (!lines.length) {
    return {
      primary: [],
      internal: [],
    };
  }

  const primary: string[] = [];
  const internal: string[] = [];
  const summaryLine =
    info.name && info.name !== "Error"
      ? `${info.name}: ${info.message}`
      : `Error: ${info.message}`;

  for (const line of lines) {
    if (line === summaryLine) {
      continue;
    }

    if (isHostCompiledRuntimeStackLine(line)) {
      internal.push(line);
      continue;
    }

    primary.push(line);
  }

  return {
    primary: primary.slice(0, MAX_PREVIEW_ERROR_STACK_LINES),
    internal: internal.slice(0, MAX_PREVIEW_ERROR_STACK_LINES),
  };
}

function extractRuntimeStackFrameName(line: string): string {
  const atIndex = line.indexOf("@");
  const frameName = atIndex >= 0 ? line.slice(0, atIndex) : line;
  return frameName.trim();
}

function isNoiseRuntimeFrame(frameName: string): boolean {
  if (!frameName) {
    return true;
  }

  return [
    "createBanyanRuntimeError",
    "generate",
    "async*refreshPreview/<",
    "refreshPreview",
    "runRuntimeAction",
    "handleMenuAction",
    "bindMenuActions/<",
    "EventListener.handleEvent*bindMenuActions",
    "bindActions",
    "initStyleEditor",
    "async*",
    "EventListener.handleEvent*",
    "",
  ].includes(frameName);
}

function summarizeInternalRuntimeStack(lines: string[]): string[] {
  const summary: string[] = [];

  for (const line of lines) {
    const frameName = extractRuntimeStackFrameName(line);
    if (isNoiseRuntimeFrame(frameName)) {
      continue;
    }

    if (summary[summary.length - 1] === frameName) {
      continue;
    }

    summary.push(frameName);
    if (summary.length >= 6) {
      break;
    }
  }

  return summary;
}

function getRuntimeErrorHint(info: RuntimeErrorInfo): string | null {
  if (info.phase !== "generate-output" || !info.sourcePath) {
    return null;
  }

  if (
    /^citations\[\d+\]\.units$/.test(info.sourcePath) &&
    / is required\.$/.test(info.message)
  ) {
    return [
      "This was raised while validating the value returned by generate(),",
      "so there is no direct script line number to map.",
      "The citation branch for this context returned no Unit",
      "(usually undefined/null because a code path did not return).",
    ].join(" ");
  }

  if (
    /^bibliography\[\d+\]\.units$/.test(info.sourcePath) &&
    / is required\.$/.test(info.message)
  ) {
    return [
      "This was raised while validating the value returned by generate(),",
      "so there is no direct script line number to map.",
      "The bibliography branch for this entry returned no Unit",
      "(usually undefined/null because a code path did not return).",
    ].join(" ");
  }

  return [
    "This was raised while validating the value returned by generate(),",
    "after your script already returned, so there is no direct script line number to map.",
  ].join(" ");
}

export function formatRuntimeErrorDetails(
  error: unknown,
  options: RuntimeErrorFormatOptions,
): FormattedRuntimeError {
  const lines: string[] = [];
  const copyLines: string[] = [];
  const seen = new Set<unknown>();
  const chain: RuntimeErrorInfo[] = [];
  let current: unknown = error;
  let depth = 0;

  while (
    current !== undefined &&
    current !== null &&
    depth <= MAX_PREVIEW_ERROR_CAUSE_DEPTH &&
    !seen.has(current)
  ) {
    seen.add(current);

    const info = toRuntimeErrorInfo(current);
    chain.push(info);
    const label =
      info.name && info.name !== "Error"
        ? `${info.name}: ${info.message}`
        : info.message;

    const detailIndent = `${getDepthIndent(depth)}  `;
    const stackLineIndent = `${detailIndent}  `;
    const header =
      depth === 0 ? label : `${getDepthIndent(depth)}Cause ${depth}: ${label}`;

    lines.push(header);
    copyLines.push(header);

    if (info.sourcePath) {
      const sourceLine = `${detailIndent}Path: ${info.sourcePath}`;
      lines.push(sourceLine);
      copyLines.push(sourceLine);
    }

    const hint = getRuntimeErrorHint(info);
    if (hint) {
      const hintLine = `${detailIndent}Hint: ${hint}`;
      lines.push(hintLine);
      copyLines.push(hintLine);
    }

    const location = formatRuntimeErrorLocation(info);
    if (location) {
      const locationLine = `${detailIndent}Location: ${location}`;
      lines.push(locationLine);
      copyLines.push(locationLine);
    }

    const stackSections = getRuntimeStackSections(info);
    if (stackSections.primary.length) {
      const stackTitle = `${detailIndent}Stack:`;
      lines.push(stackTitle);
      copyLines.push(stackTitle);
      for (const stackLine of stackSections.primary) {
        const indentedLine = `${stackLineIndent}${stackLine}`;
        lines.push(indentedLine);
        copyLines.push(indentedLine);
      }
    }

    const internalStackSummary = summarizeInternalRuntimeStack(
      stackSections.internal,
    );
    const shouldShowValidationStack =
      !stackSections.primary.length && internalStackSummary.length > 0;
    if (shouldShowValidationStack) {
      const validationTitle = `${detailIndent}Validation stack:`;
      lines.push(validationTitle);
      copyLines.push(validationTitle);
      for (const frameName of internalStackSummary) {
        const summaryLine = `${stackLineIndent}${frameName}`;
        lines.push(summaryLine);
        copyLines.push(summaryLine);
      }
    }

    const shouldIncludeInternalHostStack =
      !info.sourcePath && !location && !stackSections.primary.length;
    if (shouldIncludeInternalHostStack && stackSections.internal.length) {
      copyLines.push(`${detailIndent}Internal host stack:`);
      for (const stackLine of stackSections.internal) {
        copyLines.push(`${stackLineIndent}${stackLine}`);
      }
    }

    current = info.cause;
    depth += 1;

    if (
      current !== undefined &&
      current !== null &&
      depth <= MAX_PREVIEW_ERROR_CAUSE_DEPTH
    ) {
      copyLines.push("");
    }
  }

  const preferredInfo =
    [...chain].reverse().find((info) => {
      if (info.sourcePath) {
        return true;
      }
      if (formatRuntimeErrorLocation(info)) {
        return true;
      }
      return getRuntimeStackSections(info).primary.length > 0;
    }) ?? chain[0];
  let summary = preferredInfo?.message ?? "";

  if (!summary) {
    summary = getErrorMessage(error);
  }
  if (!lines.length) {
    const fallbackLine = `${options.errorPrefix}: ${summary}`;
    lines.push(fallbackLine);
    copyLines.push(fallbackLine);
  }

  return {
    summary,
    lines: lines.slice(0, MAX_PREVIEW_ERROR_LINES),
    copyText: copyLines.slice(0, MAX_PREVIEW_ERROR_COPY_LINES).join("\n"),
  };
}
