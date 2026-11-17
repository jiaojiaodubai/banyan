import {
  isRuntimeCode,
  type RuntimeCode,
} from "@banyan/core/sandbox/runtimeErrors";

/** Codes caused by the style itself: the user can fix these by editing the style. */
const STYLE_FAULT_CODES: readonly RuntimeCode[] = [
  "style-load",
  "style-contract",
  "generate",
  "generate-output",
  "generate-timeout",
];

/**
 * Classify a failure that came out of the core: a style fault (the style script
 * is wrong) or not (a missing capability, a malformed request, a plugin bug).
 * Branching reads `code` only, so a message edit cannot change the outcome.
 */
export function getStyleFaultCode(error: unknown): RuntimeCode | null {
  const code = (error as { code?: unknown } | null)?.code;
  return isRuntimeCode(code) && STYLE_FAULT_CODES.includes(code) ? code : null;
}
