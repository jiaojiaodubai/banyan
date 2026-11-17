import type {
  FieldCheckResult,
  FieldValidator,
  ItemFieldValidators,
} from "../../../typings/style";
import type { Item, ItemType } from "../../../typings/item";
import type { FieldCheckEntry } from "../../../typings/itemFieldValidator";
import type { SandboxCu, SandboxGlobal } from "../sandboxUtils";
import { createLogger } from "../../utils/logger";

const log = createLogger("item-field-validators");

/** Budget for one asynchronous checker, in milliseconds. */
export const FIELD_CHECK_TIMEOUT_MS = 10_000;

class InvalidFieldCheckResultError extends Error {
  constructor() {
    super("The item field checker returned an unsupported result.");
    this.name = "InvalidFieldCheckResultError";
  }
}

class FieldCheckTimeoutError extends Error {
  constructor() {
    super("The item field checker timed out.");
    this.name = "FieldCheckTimeoutError";
  }
}

/**
 * Normalize `ITEM_FIELD_VALIDATORS`: an object keyed by Zotero item type, each
 * value an array of `{ description, check }`. Invalid entries are logged and
 * dropped; the style itself still loads.
 */
export function normalizeItemFieldValidators(
  raw: unknown,
  host: Record<string, unknown>,
  sandbox: SandboxGlobal,
  Cu: SandboxCu,
): ItemFieldValidators | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  let exported: unknown;
  try {
    exported = Cu.waiveXrays ? Cu.waiveXrays(raw) : raw;
  } catch {
    exported = raw;
  }

  if (!isRecord(exported)) {
    log.warn(
      "ITEM_FIELD_VALIDATORS must be an object keyed by item type; ignored",
    );
    return undefined;
  }

  const out: ItemFieldValidators = {};

  for (const [rawType, rawEntries] of Object.entries(exported)) {
    const itemType = rawType.trim();
    if (!isItemType(itemType)) {
      log.warn(`unknown item type '${rawType}'; ignored`);
      continue;
    }
    if (!Array.isArray(rawEntries)) {
      log.warn(`'${itemType}' must be an array of checkers; ignored`);
      continue;
    }

    const validators: FieldValidator[] = [];
    for (const [index, rawEntry] of rawEntries.entries()) {
      if (!isRecord(rawEntry)) {
        log.warn(`'${itemType}'[${index}] is not an object; ignored`);
        continue;
      }

      const description =
        typeof rawEntry.description === "string"
          ? rawEntry.description.trim()
          : "";
      if (!description) {
        log.warn(
          `'${itemType}'[${index}] needs a non-empty description; ignored`,
        );
        continue;
      }

      const check = createHostCheck(rawEntry.check, sandbox, Cu);
      if (!check) {
        log.warn(
          `'${itemType}'['${description}'] needs a check function; ignored`,
        );
        continue;
      }

      validators.push({ description, check });
    }

    if (validators.length) {
      out[itemType] = validators;
    }
  }

  return Object.keys(out).length ? out : undefined;
}

/**
 * Run one item type's checkers against a snapshot. Checks run in declaration
 * order, each awaited until it settles or its timeout expires; a throwing,
 * malformed, or timed-out checker becomes an error entry and the remaining
 * checkers still run.
 */
export async function runItemFieldValidators(
  validators: readonly FieldValidator[],
  item: Readonly<Item>,
  options: { timeoutMs?: number } = {},
): Promise<FieldCheckEntry[]> {
  const timeoutMs = options.timeoutMs ?? FIELD_CHECK_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(
      "runItemFieldValidators timeoutMs must be a positive finite number.",
    );
  }

  const entries: FieldCheckEntry[] = [];
  for (const validator of validators) {
    try {
      const result = await withTimeout(
        Promise.resolve(validator.check(item)),
        timeoutMs,
      );
      entries.push(toEntry(validator, result));
    } catch (error) {
      entries.push(errorEntry(validator, error));
    }
  }
  return entries;
}

/**
 * Bridge one sandbox checker to a host callable. The result is validated once
 * it settles so the runner can trust its type.
 */
function createHostCheck(
  raw: unknown,
  sandbox: SandboxGlobal,
  Cu: SandboxCu,
):
  | ((item: Readonly<Item>) => FieldCheckResult | Promise<FieldCheckResult>)
  | undefined {
  if (typeof raw !== "function") {
    return undefined;
  }

  return (item) => {
    const sandboxItem = Cu.cloneInto(item, sandbox, {
      cloneFunctions: false,
    });
    const result = (raw as (value: unknown) => unknown)(sandboxItem);
    if (isThenable(result)) {
      return Promise.resolve(result).then(normalizeFieldCheckValue);
    }
    return normalizeFieldCheckValue(result);
  };
}

function normalizeFieldCheckValue(value: unknown): FieldCheckResult {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const message = value.trim();
    if (!message) {
      throw new InvalidFieldCheckResultError();
    }
    return message;
  }
  if (Array.isArray(value)) {
    const messages: string[] = [];
    for (const entry of value) {
      if (typeof entry !== "string" || !entry.trim()) {
        throw new InvalidFieldCheckResultError();
      }
      messages.push(entry.trim());
    }
    return messages;
  }
  throw new InvalidFieldCheckResultError();
}

function toEntry(
  validator: FieldValidator,
  result: FieldCheckResult,
): FieldCheckEntry {
  if (result === true) {
    return { description: validator.description, status: "pass", messages: [] };
  }
  if (result === false) {
    return { description: validator.description, status: "fail", messages: [] };
  }
  if (typeof result === "string") {
    return {
      description: validator.description,
      status: "fail",
      messages: [result],
    };
  }
  if (result.length === 0) {
    return { description: validator.description, status: "pass", messages: [] };
  }
  return {
    description: validator.description,
    status: "fail",
    messages: [...result],
  };
}

function errorEntry(
  validator: FieldValidator,
  error: unknown,
): FieldCheckEntry {
  if (error instanceof InvalidFieldCheckResultError) {
    return {
      description: validator.description,
      status: "error",
      messages: [],
      error: "invalid-result",
    };
  }
  if (error instanceof FieldCheckTimeoutError) {
    return {
      description: validator.description,
      status: "error",
      messages: [],
      error: "timeout",
    };
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return {
    description: validator.description,
    status: "error",
    messages: message ? [message] : [],
    error: "thrown",
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new FieldCheckTimeoutError()),
      timeoutMs,
    );
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

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isItemType(value: string): value is ItemType {
  return Boolean(Zotero.ItemTypes.getID(value));
}
