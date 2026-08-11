import type {
  CitationStyleComponent,
  CiteStyleComponent,
} from "../../../typings/style";

/** Normalize COMPONENT definition to an array<StyleComponent> */
export function normalizeComponents(
  raw: unknown,
  host: Record<string, unknown>,
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

    const itemType =
      scope === "cite" && Array.isArray(itemRecord.itemType)
        ? itemRecord.itemType
            .map((v: unknown) => String(v ?? "").trim())
            .filter(Boolean)
        : undefined;

    const cslTypeSource =
      scope !== "cite"
        ? undefined
        : Array.isArray(itemRecord.cslType)
          ? itemRecord.cslType
          : typeof itemRecord.cslType === "string"
            ? [itemRecord.cslType]
            : undefined;

    const cslType = cslTypeSource?.map((v: unknown) =>
      String(v ?? "")
        .trim()
        .toLowerCase(),
    );

    const componentBase = {
      id,
      label,
      ...(scope === "cite" && itemType?.length ? { itemType } : {}),
      ...(scope === "cite" && cslType?.length ? { cslType } : {}),
    };

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
      out.push(clonedInto as CiteStyleComponent | CitationStyleComponent);
    } catch {
      out.push(cloned as CiteStyleComponent | CitationStyleComponent);
    }
  }
  if (!out.length) return undefined;
  return scope === "cite"
    ? (out as CiteStyleComponent[])
    : (out as CitationStyleComponent[]);
}
