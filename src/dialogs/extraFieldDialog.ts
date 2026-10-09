import { useL10n } from "../utils/locale";
import { unwrapDialogIO } from "../utils/window";
import { createLogger } from "../utils/logger";

const log = createLogger("extra-field-dialog");

const t = useL10n(["extraFieldDialog.ftl"]);

type XULMenulistElement = Element & { value: string };

type PresetKey = "custom" | "type" | "genre" | "status";

type DialogResult = {
  key: string;
  value: string;
};

export type IO = {
  result: DialogResult | null;
  deferred: {
    promise: Promise<void>;
    resolve: () => void;
  };
};

const PRESET_KEYS: ReadonlyArray<{
  preset: PresetKey;
  key: string;
  labelId: string;
}> = [
  { preset: "custom", key: "", labelId: "extra-field-key-preset-custom" },
  { preset: "type", key: "Type", labelId: "extra-field-key-preset-type" },
  { preset: "genre", key: "Genre", labelId: "extra-field-key-preset-genre" },
  { preset: "status", key: "Status", labelId: "extra-field-key-preset-status" },
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
  const arg = unwrapDialogIO<IO>(window.arguments?.[0]);
  if (!arg) {
    log.warn("extraFieldDialog: window IO is missing");
    return;
  }
  io = arg;

  fillPresetMenu();
  bindEvents();
  syncKeyInputByPreset();
}

/**
 * Build the preset items here rather than in the markup, the way Zotero fills
 * its menulists (`exportOptions.js`): the menulist renders the selected item's
 * label, so the items must exist before the selection is made.
 */
function fillPresetMenu(): void {
  const menulist = document.getElementById(
    "key-preset-select",
  ) as XULMenulistElement | null;
  const popup = document.getElementById("key-preset-popup");
  if (!menulist || !popup) return;

  popup.replaceChildren();
  for (const { preset, labelId } of PRESET_KEYS) {
    const menuitem = document.createXULElement("menuitem");
    menuitem.setAttribute("value", preset);
    menuitem.setAttribute("label", t(labelId));
    popup.appendChild(menuitem);
  }
  menulist.value = "custom";
}

function bindEvents(): void {
  document.getElementById("accept-button")?.addEventListener("click", onAccept);
  document.getElementById("cancel-button")?.addEventListener("click", onCancel);
  // A XUL menulist fires `command`, not `change`.
  document
    .getElementById("key-preset-select")
    ?.addEventListener("command", () => syncKeyInputByPreset());
  document.addEventListener("keydown", onKeydown);
}

function getSelectedPreset(): PresetKey {
  const menulist = document.getElementById(
    "key-preset-select",
  ) as XULMenulistElement | null;
  const value = menulist?.value;
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
    keyInput.placeholder = t("extra-field-key-placeholder", {
      branch: "placeholder",
    });
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
