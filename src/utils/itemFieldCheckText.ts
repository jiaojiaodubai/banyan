import type { FieldCheckEntry } from "@banyan/core/validation/itemFieldValidators";
import { useL10n } from "./locale";

const t = useL10n(["itemFieldValidatorDialog.ftl"]);

export type ItemFieldCheckStatus = FieldCheckEntry["status"];

export function fieldCheckStatusText(status: ItemFieldCheckStatus): string {
  switch (status) {
    case "pass":
      return t("item-field-validator-status-pass");
    case "fail":
      return t("item-field-validator-status-fail");
    default:
      return t("item-field-validator-status-error");
  }
}

/** Human-readable detail for one non-passing check. */
export function formatFieldCheckDetail(check: FieldCheckEntry): string {
  if (check.status === "pass") return "";
  if (check.status === "error") {
    if (check.error === "invalid-result") {
      return t("item-field-validator-check-invalid-result");
    }
    if (check.error === "timeout") {
      return t("item-field-validator-check-timeout");
    }
    return check.messages.length
      ? t("item-field-validator-check-error", {
          args: { message: check.messages.join(" · ") },
        })
      : t("item-field-validator-check-error-unknown");
  }
  return check.messages.join(" · ");
}

/** Whether the run must stop before saving unless the user overrides it. */
export function hasBlockingFieldChecks(
  checks: readonly FieldCheckEntry[],
): boolean {
  return checks.some((check) => check.status !== "pass");
}
