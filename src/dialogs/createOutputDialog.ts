import { useL10n } from "../utils/locale";

const t = useL10n(["createOutputDialog.ftl"]);

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
  io = window.arguments[0].wrappedJSObject as IO;

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
  const select = document.getElementById(
    "style-select",
  ) as HTMLSelectElement | null;
  if (!select) return;

  select.replaceChildren();

  const styles = Array.from(addon.data.styles.files.values()).sort((a, b) =>
    a.title.localeCompare(b.title),
  );

  if (styles.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = t("create-output-no-styles");
    option.disabled = true;
    select.appendChild(option);
    return;
  }

  for (const style of styles) {
    const option = document.createElement("option");
    option.value = style.id;
    option.textContent = style.title;
    select.appendChild(option);
  }

  if (select.options.length > 0) {
    select.selectedIndex = 0;
  }
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
    ztoolkit.logError(e);
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
  document
    .getElementById("style-select")
    ?.addEventListener("change", () => updateCitationLabel());
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
  const select = document.getElementById(
    "style-select",
  ) as HTMLSelectElement | null;
  const label = document.getElementById("output-type-citation-label");
  if (!select || !label || !select.value) return;

  const styleFile = addon.data.styles.files.get(select.value);
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

  const select = document.getElementById(
    "style-select",
  ) as HTMLSelectElement | null;
  if (!select || !select.value) {
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
    styleId: select.value,
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
    ztoolkit.logError(e);
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
