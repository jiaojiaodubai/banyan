import { useL10n } from "../utils/locale";
import { createLogger } from "../utils/logger";
import { unwrapDialogIO } from "../utils/window";

const log = createLogger("extra-field-dialog");

const t = useL10n(["extraFieldDialog.ftl"]);

type XULMenulistElement = Element & { value: string; disabled: boolean };

type PresetKey = "custom" | "type" | "genre" | "status";

type DialogResult = {
  key: string;
  value: string;
};

export type IO = {
  /** Prefills the key field; a known preset key selects its preset entry. */
  initialKey?: string;
  /** Prefills the value field. */
  initialValue?: string;
  /** Keeps the key fixed, for callers that already know which field they need. */
  lockKey?: boolean;
  /** Extra explanation shown above the form; the caller localizes it. */
  hint?: string;
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
    log.error("Window IO is missing");
    return;
  }
  io = arg;

  fillPresetMenu();
  bindEvents();
  updateHint();
  applyInitialValues();
  syncKeyInputByPreset();
}

/** Key fixed by the caller, or `""` when the user may edit it. */
function getLockedKey(): string {
  if (!io?.lockKey) {
    return "";
  }
  return String(io.initialKey ?? "").trim();
}

function updateHint(): void {
  const hint = document.getElementById("hint-info") as HTMLElement | null;
  if (!hint) return;
  const text = String(io?.hint ?? "").trim();
  hint.textContent = text;
  hint.hidden = !text;
}

function findPresetForKey(key: unknown): PresetKey | null {
  const normalized = String(key ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  const match = PRESET_KEYS.find(
    (entry) =>
      entry.preset !== "custom" && entry.key.toLowerCase() === normalized,
  );
  return match?.preset ?? null;
}

function applyInitialValues(): void {
  if (!io) return;
  const menulist = document.getElementById(
    "key-preset-select",
  ) as XULMenulistElement | null;
  const keyInput = document.getElementById(
    "key-input",
  ) as HTMLInputElement | null;
  const valueInput = document.getElementById(
    "value-input",
  ) as HTMLInputElement | null;

  const presetForInitialKey = findPresetForKey(io.initialKey);
  if (menulist && presetForInitialKey) {
    menulist.value = presetForInitialKey;
  } else if (keyInput) {
    keyInput.value = String(io.initialKey ?? "");
  }

  if (valueInput) {
    valueInput.value = String(io.initialValue ?? "");
  }
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
  const select = document.getElementById(
    "key-preset-select",
  ) as XULMenulistElement | null;
  if (!keyInput) return;

  const lockedKey = getLockedKey();
  if (lockedKey) {
    if (select) {
      select.disabled = true;
    }
    keyInput.disabled = true;
    keyInput.value = lockedKey;
    keyInput.placeholder = "";
    (
      document.getElementById("value-input") as HTMLInputElement | null
    )?.focus();
    return;
  }

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
