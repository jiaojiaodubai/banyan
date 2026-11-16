import { useL10n } from "../utils/locale";
import { unwrapDialogIO } from "../utils/window";
import { createLogger } from "../utils/logger";

const log = createLogger("preset-value-dialog");

const t = useL10n(["presetValueDialog.ftl"]);

/** What the dialog reads from `window.arguments[0]`. */
export type IO = {
  /** Fixed key the preset needs a value for. */
  key: string;
  /** Caller-localized explanation shown above the field. */
  hint: string;
  result: string | null;
  deferred: {
    promise: Promise<void>;
    resolve: () => void;
  };
};

let io: IO | null = null;
let resolved = false;

window.addEventListener("load", initPresetValueDialog);
window.addEventListener("unload", () => {
  if (!resolved && io) {
    io.result = null;
    io.deferred.resolve();
  }
});

function initPresetValueDialog(): void {
  const arg = unwrapDialogIO<IO>(window.arguments?.[0]);
  if (!arg) {
    log.error("window IO is missing");
    return;
  }
  io = arg;
  renderHint();
  renderKey();
  bindEvents();
  (document.getElementById("value-input") as HTMLInputElement | null)?.focus();
}

function renderHint(): void {
  const hint = document.getElementById("hint-info") as HTMLElement | null;
  if (!hint) return;
  const text = String(io?.hint ?? "").trim();
  hint.textContent = text;
  hint.hidden = !text;
}

function renderKey(): void {
  const key = document.getElementById("key-label") as HTMLElement | null;
  if (!key) return;
  key.textContent = String(io?.key ?? "");
}

function bindEvents(): void {
  document.getElementById("accept-button")?.addEventListener("click", onAccept);
  document.getElementById("cancel-button")?.addEventListener("click", onCancel);
  document.getElementById("value-input")?.addEventListener("input", () => {
    const error = document.getElementById("error-info") as HTMLElement | null;
    if (error) error.hidden = true;
  });
  document.addEventListener("keydown", onKeydown);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    onCancel();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    onAccept();
  }
}

function onAccept(): void {
  if (!io) return;
  const input = document.getElementById(
    "value-input",
  ) as HTMLInputElement | null;
  const value = input?.value.trim() ?? "";
  if (!value) {
    showError(t("preset-value-error-required"));
    input?.focus();
    return;
  }
  io.result = value;
  resolved = true;
  io.deferred.resolve();
  window.close();
}

function onCancel(): void {
  if (!io) return;
  io.result = null;
  resolved = true;
  io.deferred.resolve();
  window.close();
}

function showError(message: string): void {
  const error = document.getElementById("error-info") as HTMLElement | null;
  if (!error) return;
  error.textContent = message;
  error.hidden = false;
}
