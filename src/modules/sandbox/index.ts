/**
 * Thin adapter: assemble the Zotero host (`./runtime`, `./capabilities`,
 * `./items`) and run the core loader.
 *
 * The plugin's call sites keep using this module, while the loader, the utility
 * table, the validators and the output normalizer live in `@banyan/core`.
 */
import type {
  CitationContext,
  StyleOptionValues,
} from "@banyan/core/types/style";
import type { StyleHost } from "@banyan/core/host";
import { assertHostCapabilities } from "@banyan/core/host";
import type {
  StyleInstance,
  StyleMessage,
  StyleMessageDetail,
} from "@banyan/core/messages";
import {
  createStyle as coreCreateStyle,
  type CreateStyleOptions,
} from "@banyan/core/sandbox/createStyle";
import { zoteroCapabilities } from "./capabilities";
import { geckoSandboxRuntime } from "./runtime";
import { createLogger } from "../../utils/logger";
import { getTopWindow } from "../../utils/window";

const log = createLogger("sandbox");

export type { CreateStyleOptions } from "@banyan/core/sandbox/createStyle";

export type {
  StyleDiagnostic,
  StyleDiagnosticLevel,
  StyleDiagnostics,
  StyleInstance,
  StyleMessage,
  StyleMessageSink,
  StyleSeverity,
} from "@banyan/core/messages";

/**
 * Everything the core needs from Zotero, collected in one object. Readiness is
 * structural here: the runtime and the capabilities are module-level values, so
 * a style can only be created once this bundle has finished loading; the gate
 * asserts the contract is complete.
 */
export const zoteroStyleHost: StyleHost = {
  runtime: geckoSandboxRuntime,
  capabilities: zoteroCapabilities,
  assertReady: () => assertHostCapabilities(zoteroCapabilities),
};

/**
 * How this host surfaces a failed style run.
 *
 * The core reports failures as exceptions and findings as data, so this host
 * decides how to notify users. Only one case gets a dialog: `generate()`
 * returning something unusable. All other cases remain with the caller that
 * already handles them.
 */
function reportGenerateFailure(error: unknown): void {
  const record = error as {
    code?: unknown;
    sourcePath?: unknown;
    message?: unknown;
  } | null;
  if (
    record?.code !== "generate-output" ||
    record?.sourcePath !== "generate()"
  ) {
    return;
  }
  const message =
    typeof record.message === "string" && record.message
      ? record.message
      : String(error);
  // Parent the dialog to the window on top: `generate()` may run from a modal
  // dialog (create-output), and an alert owned by the main window underneath it
  // blocks the thread without ever being shown.
  (getTopWindow() ?? Zotero.getMainWindow()).alert(message);
}

/** Wrap the only generate entry point so a failure is reported the same way. */
function withSandboxErrorReporting(style: StyleInstance): StyleInstance {
  return {
    ...style,
    generate: async (
      contexts: CitationContext[],
      options?: StyleOptionValues,
    ) => {
      try {
        return await style.generate(contexts, options);
      } catch (error) {
        reportGenerateFailure(error);
        throw error;
      }
    },
  };
}

/**
 * Identify the style and the declaration a finding belongs to. The core fills
 * `detail` from `INFO` and the declaration walk, so the host never parses the
 * message or the source to locate one.
 */
function nonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function styleLabelFromDetail(detail: StyleMessageDetail | undefined): string {
  const style = detail?.style;
  return [nonEmptyString(style?.id), nonEmptyString(style?.title)]
    .filter(Boolean)
    .join(" / ");
}

/**
 * One-line declaration location for logs and preview rows:
 * `STYLE_OPTIONS[0] 'mode'`, `CITE_PARAMS[1] 'pages'.fields[0] 'start'`,
 * `ITEM_FIELD_VALIDATORS 'book'[2] 'must have a title'`.
 */
export function formatStyleMessageLocation(
  detail: StyleMessageDetail | undefined,
): string {
  const declaration = detail?.declaration;
  const exportName = nonEmptyString(declaration?.export);
  if (!exportName) {
    return "";
  }

  let location = exportName;
  const group = nonEmptyString(declaration?.group);
  if (group) {
    location += ` '${group}'`;
  }
  if (
    typeof declaration?.index === "number" &&
    Number.isFinite(declaration.index)
  ) {
    location += `[${declaration.index}]`;
  }

  const id = nonEmptyString(declaration?.id);
  if (id) {
    location += ` '${id}'`;
  }

  const field = nonEmptyString(declaration?.field);
  if (field) {
    location += `.fields`;
    if (
      typeof declaration?.fieldIndex === "number" &&
      Number.isFinite(declaration.fieldIndex)
    ) {
      location += `[${declaration.fieldIndex}]`;
    }
    location += ` '${field}'`;
  }
  return location;
}

/**
 * Route one core message into the plugin logger, at the severity the core gave:
 * trace lines are sandbox debugging output, findings also reach the error
 * console so a style cannot complain into the void.
 */
export function logStyleMessage(message: StyleMessage, styleLabel = ""): void {
  const label = styleLabel || styleLabelFromDetail(message.detail);
  const location = formatStyleMessageLocation(message.detail);
  const scope = label ? `[style=${label}] ` : "";
  const where = location ? `[${location}] ` : "";
  const line = `${scope}${where}${message.source} (${message.code}): ${message.message}`;
  switch (message.severity) {
    case "trace":
      log.debug(line);
      return;
    case "info":
      log.info(line);
      return;
    case "warning":
      log.warn(line);
      return;
    default:
      log.error(line);
  }
}

/**
 * Load a style and wrap its generate entry point with this host's failure
 * reporting. Every style the plugin loads reports its records to the Zotero log
 * unless the caller passes its own sink (the style editor preview does);
 * `style.diagnostics` stays available for callers that want the findings.
 */
export async function createStyle(
  code: string,
  options: CreateStyleOptions = {},
): Promise<StyleInstance> {
  const messageSink =
    options.messageSink ??
    ((message: StyleMessage) => logStyleMessage(message));
  const style = await coreCreateStyle(zoteroStyleHost, code, {
    ...options,
    messageSink,
  });
  return withSandboxErrorReporting(style);
}
