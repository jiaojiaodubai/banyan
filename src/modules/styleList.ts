/**
 * Serialize parameter declarations for the automation style list.
 *
 * Functions cannot cross the HTTP boundary, so this keeps only what an agent
 * needs to choose or configure a style: identity, text, kind, default value,
 * closed states, suggested values, list fields and bounds, and flags for the
 * runtime callbacks.
 */
import type {
  StyleOptionParam,
  CitationParam,
  CiteParam,
  ListFieldParam,
  ParamPreset,
} from "@banyan/core/types/style";
import type { ParamInfo } from "../../typings/styleIndex";

type AnyParam = StyleOptionParam | CitationParam | CiteParam;

export function toParamInfo(param: AnyParam | ListFieldParam): ParamInfo {
  const base: ParamInfo = {
    id: param.id,
    kind: param.kind,
    label: param.label,
    ...(param.description ? { description: param.description } : {}),
  };

  if (param.kind === "state") {
    return {
      ...base,
      ...(param.defaultValue === undefined
        ? {}
        : { defaultValue: param.defaultValue }),
      ...(param.states ? { states: { ...param.states } } : {}),
      ...("forcedValue" in param && param.forcedValue !== undefined
        ? { hasForcedValue: true as const }
        : {}),
      ...("applicable" in param && param.applicable
        ? { hasApplicable: true as const }
        : {}),
    };
  }

  if (param.kind === "list") {
    return {
      ...base,
      ...(param.defaultValue === undefined
        ? {}
        : { defaultValue: param.defaultValue }),
      fields: param.fields.map((field) => toParamInfo(field)),
      ...(param.min === undefined ? {} : { min: param.min }),
      ...(param.max === undefined ? {} : { max: param.max }),
      ...(param.forcedValue !== undefined
        ? { hasForcedValue: true as const }
        : {}),
      ...("applicable" in param && param.applicable
        ? { hasApplicable: true as const }
        : {}),
    };
  }

  return {
    ...base,
    ...(param.defaultValue === undefined
      ? {}
      : { defaultValue: param.defaultValue }),
    ...(param.presets ? { presets: clonePresets(param.presets) } : {}),
    ...(param.format ? { format: param.format } : {}),
    ...("forcedValue" in param && param.forcedValue !== undefined
      ? { hasForcedValue: true as const }
      : {}),
    ...("applicable" in param && param.applicable
      ? { hasApplicable: true as const }
      : {}),
    ...(param.validate ? { hasValidate: true as const } : {}),
  };
}

export function toStyleOptionParamInfos(
  params: readonly StyleOptionParam[] | undefined,
): ParamInfo[] {
  return (params ?? []).map((param) => toParamInfo(param));
}

function clonePresets(presets: readonly ParamPreset[]): readonly ParamPreset[] {
  return presets.map((preset) =>
    typeof preset === "string"
      ? { label: preset, value: preset }
      : { ...preset },
  );
}
