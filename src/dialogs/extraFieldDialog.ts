import { useL10n } from "../utils/locale";

const t = useL10n(["extraFieldDialog.ftl"]);

type PresetKey = "custom" | "type" | "genre" | "status";

type DialogResult = {
  key: string;
  value: string;
};

export type IO = {
  itemCount: number;
  result: DialogResult | null;
  deferred: {
    promise: Promise<void>;
    resolve: () => void;
  };
};

const PRESET_KEYS: ReadonlyArray<{ preset: PresetKey; key: string }> = [
  { preset: "custom", key: "" },
  { preset: "type", key: "Type" },
  { preset: "genre", key: "Genre" },
  { preset: "status", key: "Status" },
];

let io: IO | null = null;
let resolved = false;

window.addEventListener("load", initExtraFieldDialog);
window.addEventListener("unload", () => {
  if (!resolved && io) {
    io.result = null;
    io.deferred.resolve();
  }
});

function initExtraFieldDialog(): void {
  io = window.arguments[0].wrappedJSObject as IO;

  bindEvents();
  updateItemCount();
  syncKeyInputByPreset();
}

function bindEvents(): void {
  document.getElementById("accept-button")?.addEventListener("click", onAccept);
  document.getElementById("cancel-button")?.addEventListener("click", onCancel);
  document
    .getElementById("key-preset-select")
    ?.addEventListener("change", () => syncKeyInputByPreset());
  document.addEventListener("keydown", onKeydown);
}

function updateItemCount(): void {
  const info = document.getElementById("item-count-info");
  if (!info || !io) return;

  const count = io.itemCount;
  info.textContent =
    count === 1
      ? t("extra-field-item-count-single")
      : t("extra-field-item-count-multiple", { args: { count } });
}

function getSelectedPreset(): PresetKey {
  const select = document.getElementById(
    "key-preset-select",
  ) as HTMLSelectElement | null;
  const value = select?.value;
  return value === "type" || value === "genre" || value === "status"
    ? value
    : "custom";
}

function getPresetKey(preset: PresetKey): string {
  return PRESET_KEYS.find((entry) => entry.preset === preset)?.key ?? "";
}

function syncKeyInputByPreset(): void {
  const keyInput = document.getElementById(
    "key-input",
  ) as HTMLInputElement | null;
  if (!keyInput) return;

  const preset = getSelectedPreset();
  if (preset === "custom") {
    if (keyInput.disabled) {
      keyInput.value = "";
    }
    keyInput.disabled = false;
    keyInput.placeholder = t("extra-field-key-placeholder");
    keyInput.focus();
    return;
  }

  keyInput.disabled = true;
  keyInput.value = getPresetKey(preset);
  keyInput.placeholder = "";
}

function onKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    onAccept();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    onCancel();
  }
}

function onAccept(): void {
  if (!io) return;

  const keyInput = document.getElementById(
    "key-input",
  ) as HTMLInputElement | null;
  const valueInput = document.getElementById(
    "value-input",
  ) as HTMLInputElement | null;
  if (!keyInput || !valueInput) {
    return;
  }

  const preset = getSelectedPreset();
  const key =
    preset === "custom" ? keyInput.value.trim() : getPresetKey(preset);
  const value = valueInput.value.trim();

  if (!key) {
    showDialogError(t("extra-field-error-key-required"));
    if (!keyInput.disabled) {
      keyInput.focus();
    }
    return;
  }

  if (!value) {
    showDialogError(t("extra-field-error-value-required"));
    valueInput.focus();
    return;
  }

  io.result = { key, value };
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

function showDialogError(message: string): void {
  Zotero.Prompt.confirm({
    window,
    title: t("extra-field-error-title"),
    text: message,
    button0: Zotero.Prompt.BUTTON_TITLE_OK,
  });
}
