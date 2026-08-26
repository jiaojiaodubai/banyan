import type {
  CitationStyleComponent,
  Cite,
  CiteDisabledPredicate,
  CiteVisibilityPredicate,
  CiteStyleComponent,
} from "../../../typings/style";
import type { SandboxCu, SandboxGlobal } from "../sandboxUtils";

/** Normalize COMPONENT definition to an array<StyleComponent> */
export function normalizeComponents(
  raw: unknown,
  host: Record<string, unknown>,
  sandbox: SandboxGlobal,
  Cu: SandboxCu,
  scope: "cite",
): CiteStyleComponent[] | undefined;
export function normalizeComponents(
  raw: unknown,
  host: Record<string, unknown>,
  sandbox: SandboxGlobal,
  Cu: SandboxCu,
  scope: "citation",
): CitationStyleComponent[] | undefined;
export function normalizeComponents(
  raw: unknown,
  host: Record<string, unknown>,
  sandbox: SandboxGlobal,
  Cu: SandboxCu,
  scope: "cite" | "citation",
): CiteStyleComponent[] | CitationStyleComponent[] | undefined {
  if (!raw) return undefined;
  const utils = Zotero.getMainWindow().Cu;
  let cmp: unknown;
  try {
    cmp = utils.waiveXrays ? utils.waiveXrays(raw) : raw;
  } catch {
    cmp = raw;
  }
  // Accept array or object map
  let arr: unknown[] | undefined;
  if (Array.isArray(cmp)) arr = cmp;
  else if (cmp && typeof cmp === "object") arr = Object.values(cmp);
  if (!arr || !arr.length) return undefined;

  // Shallow-clone into host and basic shape validation
  const out: Array<CiteStyleComponent | CitationStyleComponent> = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const itemRecord = item as Record<string, unknown>;
    const id = String(itemRecord.id || "").trim();
    const type = String(itemRecord.type || "").trim();
    const label = String(itemRecord.label || id || "").trim();
    if (!id || !type) {
      continue;
    }

    const componentBase = { id, label };
    const visibility =
      scope === "cite" && typeof itemRecord.visible === "function"
        ? createVisibilityEvaluator(itemRecord.visible, sandbox, Cu)
        : undefined;
    const disabled =
      scope === "cite" && typeof itemRecord.disabled === "function"
        ? createDisabledEvaluator(itemRecord.disabled, sandbox, Cu)
        : undefined;

    let cloned: CiteStyleComponent | CitationStyleComponent;
    if (type === "checkbox") {
      let value: boolean;
      if (typeof itemRecord.value === "boolean") value = itemRecord.value;
      else if (typeof itemRecord.value === "string")
        value = itemRecord.value.toLowerCase() === "true";
      else value = Boolean(itemRecord.value);
      cloned = { ...componentBase, type, value };
    } else if (type === "input") {
      const value =
        typeof itemRecord.value === "string"
          ? itemRecord.value
          : String(itemRecord.value ?? "");
      cloned = { ...componentBase, type, value };
    } else if (type === "select") {
      const value =
        typeof itemRecord.value === "string"
          ? itemRecord.value
          : String(itemRecord.value ?? "");
      const rawOption =
        itemRecord.options && typeof itemRecord.options === "object"
          ? (itemRecord.options as Record<string, unknown>)
          : undefined;
      const normalizedOptions = Object.fromEntries(
        Object.entries(rawOption ?? {}).map(([optionValue, optionLabel]) => [
          optionValue,
          String(optionLabel ?? ""),
        ]),
      );
      const firstOptionValue = Object.keys(normalizedOptions)[0] || "";
      const resolvedValue = value || firstOptionValue;
      cloned = {
        ...componentBase,
        type,
        value: resolvedValue,
        options: normalizedOptions,
      };
    } else {
      continue;
    }

    try {
      const clonedInto = Cu.cloneInto ? Cu.cloneInto(cloned, host) : cloned;
      const hostComponent = { ...(clonedInto as object) } as
        CiteStyleComponent | CitationStyleComponent;
      if (visibility) {
        (hostComponent as CiteStyleComponent).visible = visibility;
      }
      if (disabled) {
        (hostComponent as CiteStyleComponent).disabled = disabled;
      }
      out.push(hostComponent);
    } catch {
      const fallback = { ...cloned } as
        CiteStyleComponent | CitationStyleComponent;
      if (visibility) {
        (fallback as CiteStyleComponent).visible = visibility;
      }
      if (disabled) {
        (fallback as CiteStyleComponent).disabled = disabled;
      }
      out.push(fallback);
    }
  }
  if (!out.length) return undefined;
  return scope === "cite"
    ? (out as CiteStyleComponent[])
    : (out as CitationStyleComponent[]);
}

function createVisibilityEvaluator(
  raw: Function,
  sandbox: SandboxGlobal,
  Cu: SandboxCu,
): CiteVisibilityPredicate {
  return (item) => {
    try {
      const sandboxItem = Cu.cloneInto(item, sandbox, {
        cloneFunctions: false,
      });
      return raw(sandboxItem) === true;
    } catch (error) {
      ztoolkit.logError(error);
      return false;
    }
  };
}

function createDisabledEvaluator(
  raw: Function,
  sandbox: SandboxGlobal,
  Cu: SandboxCu,
): CiteDisabledPredicate {
  return (cite: Readonly<Cite>) => {
    try {
      const sandboxCite = Cu.cloneInto(cite, sandbox, {
        cloneFunctions: false,
      });
      return raw(sandboxCite) === true;
    } catch (error) {
      ztoolkit.logError(error);
      return false;
    }
  };
}
