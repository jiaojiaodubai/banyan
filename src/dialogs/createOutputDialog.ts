import { useL10n } from "../utils/locale";
import { unwrapDialogIO } from "../utils/window";
import { createLogger } from "../utils/logger";

const log = createLogger("create-output-dialog");

const t = useL10n(["createOutputDialog.ftl"]);

type XULMenulistElement = Element & { value: string };

export type IO = {
  result: {
    styleId: string;
    outputType: "citation" | "bibliography";
    outputFormat: "html" | "text";
    outputMethod: "clipboard" | "file";
  } | null;
  items: Array<unknown>;
  deferred: {
    promise: Promise<void>;
    resolve: () => void;
  };
};

let io: IO | null = null;
let resolved = false;

window.addEventListener("load", initCreateOutputDialog);
window.addEventListener("unload", () => {
  if (!resolved && io) {
    io.result = null;
    io.deferred.resolve();
  }
});

async function initCreateOutputDialog(): Promise<void> {
  const arg = unwrapDialogIO<IO>(window.arguments?.[0]);
  if (!arg) {
    log.warn("createOutputDialog: window IO is missing");
    return;
  }
  io = arg;

  updateItemCount();
  populateStyleSelector();
  restoreSavedSettings();
  bindEvents();
  updateCitationLabel();
}

function updateItemCount(): void {
  const itemCountInfo = document.getElementById("item-count-info");
  if (!itemCountInfo || !io) return;

  const count = io.items.length;
  itemCountInfo.textContent =
    count === 1
      ? t("create-output-item-count-single")
      : t("create-output-item-count-multiple", { args: { count } });
}

function populateStyleSelector(): void {
  const menulist = document.getElementById(
    "style-select",
  ) as XULMenulistElement | null;
  const popup = document.getElementById("style-popup");
  if (!menulist || !popup) return;

  popup.replaceChildren();

  const styles = Array.from(addon.data.styles.files.values()).sort((a, b) =>
    a.title.localeCompare(b.title),
  );

  if (styles.length === 0) {
    const menuitem = document.createXULElement("menuitem");
    menuitem.setAttribute("label", t("create-output-no-styles"));
    menuitem.setAttribute("disabled", "true");
    popup.appendChild(menuitem);
    return;
  }

  for (const style of styles) {
    const menuitem = document.createXULElement("menuitem");
    menuitem.setAttribute("label", style.title);
    menuitem.setAttribute("value", style.id);
    popup.appendChild(menuitem);
  }

  menulist.value = styles[0].id;
}

function restoreSavedSettings(): void {
  try {
    const raw = Zotero.Prefs.get(
      "extensions.zotero.banyan.export.outputSettings",
    );
    const settings = raw ? JSON.parse(String(raw)) : {};

    setRadioValue("output-type", settings.outputType);
    setRadioValue("output-format", settings.outputFormat);
    setRadioValue("output-method", settings.outputMethod);
  } catch (e) {
    log.error("Failed to restore previous output settings", e);
  }
}

function setRadioValue(name: string, value: unknown): void {
  if (typeof value !== "string") return;
  const input = document.querySelector<HTMLInputElement>(
    `input[name="${name}"][value="${value}"]`,
  );
  if (input) {
    input.checked = true;
  }
}

function bindEvents(): void {
  document.getElementById("accept-button")?.addEventListener("click", onAccept);
  document.getElementById("cancel-button")?.addEventListener("click", onCancel);
  // A XUL menulist fires `command`, not `change`.
  document
    .getElementById("style-select")
    ?.addEventListener("command", () => updateCitationLabel());
  document.addEventListener("keydown", onKeydown);
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

function updateCitationLabel(): void {
  const menulist = document.getElementById(
    "style-select",
  ) as XULMenulistElement | null;
  const label = document.getElementById("output-type-citation-label");
  if (!menulist || !label || !menulist.value) return;

  const styleFile = addon.data.styles.files.get(menulist.value);
  if (!styleFile) return;

  label.textContent =
    styleFile.citationType === "note-citation"
      ? t("create-output-type-citation-note")
      : t("create-output-type-citation-inline");
}

function getCheckedValue<T extends string>(name: string): T | null {
  const checked = document.querySelector<HTMLInputElement>(
    `input[name="${name}"]:checked`,
  );
  return (checked?.value as T | undefined) ?? null;
}

function onAccept(): void {
  if (!io) return;

  const menulist = document.getElementById(
    "style-select",
  ) as XULMenulistElement | null;
  if (!menulist || !menulist.value) {
    ztoolkit.getGlobal("alert")(t("create-output-error-no-style"));
    return;
  }

  const outputType = getCheckedValue<"citation" | "bibliography">(
    "output-type",
  );
  const outputFormat = getCheckedValue<"html" | "text">("output-format");
  const outputMethod = getCheckedValue<"clipboard" | "file">("output-method");

  if (!outputType || !outputFormat || !outputMethod) {
    ztoolkit.getGlobal("alert")(t("create-output-error-incomplete"));
    return;
  }

  io.result = {
    styleId: menulist.value,
    outputType,
    outputFormat,
    outputMethod,
  };

  try {
    Zotero.Prefs.set(
      "extensions.zotero.banyan.export.outputSettings",
      JSON.stringify({ outputType, outputFormat, outputMethod }),
    );
  } catch (e) {
    log.error("Failed to restore previous output settings", e);
  }

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
