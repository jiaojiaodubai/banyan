import { useL10n } from "../utils/locale";
import { unwrapDialogIO } from "../utils/window";
import { createLogger } from "../utils/logger";
import type {
  StyleOptionParam,
  StyleOptionValues,
} from "@banyan/core/types/style";
import {
  resolveStyleOptionState,
  type StyleOptionState,
} from "@banyan/core/validation/paramValues";
import { getStyleOptionState } from "../modules/styles";
import { createXULElementCompat, ParameterPanel } from "../ui/parameterPanel";

const log = createLogger("create-output-dialog");

const t = useL10n(["createOutputDialog.ftl"]);

type XULMenulistElement = Element & { value: string };

export type IO = {
  result: {
    styleId: string;
    styleOptions?: StyleOptionValues;
    outputType: "citation" | "bibliography";
    outputFormat: "html" | "text";
    outputMethod: "clipboard" | "file";
  } | null;
  items: Array<unknown>;
  /**
   * Generate the output. Awaited before the dialog closes: a style sandbox run
   * that resumes after this modal window is gone never settles. The native
   * file picker then opens after the dialog, once it is no longer disabled.
   */
  render: () => Promise<void>;
};

let io: IO | null = null;
/** True while `onAccept()` runs the output; blocks a second accept. */
let running = false;

/** Per-style drafts, kept while the dialog is open. */
const optionDrafts = new Map<string, StyleOptionValues>();
let optionParams: StyleOptionParam[] = [];
let optionState: StyleOptionState = {
  storedValues: {},
  valueSources: {},
  effectiveValues: {},
  states: {},
};
let optionPanel: ParameterPanel<StyleOptionParam> | null = null;
let optionsValid = true;
let optionsRequest = 0;
/** Style whose option panel is on screen; empty while loading. */
let optionsReadyStyleId = "";
/** The in-flight load, so an early Accept can wait instead of doing nothing. */
let optionsLoadPromise: Promise<void> | null = null;
/** Style that `optionsLoadPromise` belongs to. */
let optionsLoadStyleId = "";

window.addEventListener("load", initCreateOutputDialog);

async function initCreateOutputDialog(): Promise<void> {
  const arg = unwrapDialogIO<IO>(window.arguments?.[0]);
  if (!arg) {
    log.error("window IO is missing");
    return;
  }
  io = arg;

  updateItemCount();
  populateStyleSelector();
  restoreSavedSettings();
  bindEvents();
  updateCitationLabel();
  void showStyleOptions();
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
    log.error("恢复上次的输出设置失败", e);
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
  document.getElementById("style-select")?.addEventListener("command", () => {
    updateCitationLabel();
    void showStyleOptions();
  });
  document.addEventListener("keydown", onKeydown);
}

function onKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    void onAccept();
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

async function showStyleOptions(): Promise<void> {
  const menulist = document.getElementById(
    "style-select",
  ) as XULMenulistElement | null;
  if (!menulist?.value) {
    clearStyleOptions();
    return;
  }
  const styleFile = addon.data.styles.files.get(menulist.value);
  if (!styleFile) {
    clearStyleOptions();
    return;
  }

  const request = ++optionsRequest;
  optionsReadyStyleId = "";
  optionsLoadStyleId = styleFile.id;
  updateAcceptDisabled();
  const load = (async () => {
    let next: Awaited<ReturnType<typeof getStyleOptionState>>;
    try {
      next = await getStyleOptionState(
        { id: styleFile.id, title: styleFile.title },
        optionDrafts.get(styleFile.id),
      );
    } catch (e) {
      log.error("读取样式全局选项失败", e);
      reportStyleOptionsFailure(request);
      return;
    }
    if (request !== optionsRequest) return;

    try {
      optionParams = next.params;
      optionState = next.state;
      optionDrafts.set(styleFile.id, { ...next.state.storedValues });
      renderStyleOptions(styleFile.id);
      optionsReadyStyleId = styleFile.id;
      updateAcceptDisabled();
    } catch (e) {
      log.error("渲染样式全局选项失败", e);
      reportStyleOptionsFailure(request);
    }
  })();
  optionsLoadPromise = load;
  await load;
}

function reportStyleOptionsFailure(request: number): void {
  if (request !== optionsRequest) return;
  clearStyleOptions();
  showStyleOptionsFailure();
}

/**
 * Wait for the selected style's options when Accept arrives during a load.
 * Returns false when there is no load for this style to wait for (the load
 * failed, or the style was never readable).
 */
async function waitForStyleOptions(styleId: string): Promise<boolean> {
  while (optionsReadyStyleId !== styleId) {
    const pending = optionsLoadPromise;
    if (!pending || optionsLoadStyleId !== styleId) {
      return false;
    }
    await pending;
    if (optionsLoadPromise === pending) {
      return optionsReadyStyleId === styleId;
    }
  }
  return true;
}

function updateAcceptDisabled(): void {
  const acceptButton = document.getElementById(
    "accept-button",
  ) as HTMLButtonElement | null;
  if (!acceptButton) return;
  const menulist = document.getElementById(
    "style-select",
  ) as XULMenulistElement | null;
  const styleId = menulist?.value ?? "";
  acceptButton.disabled =
    running || (Boolean(styleId) && optionsReadyStyleId !== styleId);
}

/**
 * A failed load leaves no panel to validate against, so Accept stays disabled;
 * say why instead of leaving the dialog looking frozen.
 */
function showStyleOptionsFailure(): void {
  const block = document.getElementById(
    "style-options-block",
  ) as HTMLElement | null;
  const container = document.getElementById(
    "style-options",
  ) as HTMLElement | null;
  if (!block || !container) return;
  block.hidden = false;
  container.replaceChildren();
  const message = document.createElement("div");
  message.className = "style-options-error";
  message.textContent = t("create-output-error-options-unavailable");
  container.appendChild(message);
}

function clearStyleOptions(): void {
  optionsRequest++;
  optionsReadyStyleId = "";
  optionPanel = null;
  optionParams = [];
  optionState = {
    storedValues: {},
    valueSources: {},
    effectiveValues: {},
    states: {},
  };
  optionsValid = true;
  const block = document.getElementById(
    "style-options-block",
  ) as HTMLElement | null;
  const container = document.getElementById(
    "style-options",
  ) as HTMLElement | null;
  if (block) block.hidden = true;
  container?.replaceChildren();
  updateAcceptDisabled();
}

function renderStyleOptions(styleId: string): void {
  const block = document.getElementById(
    "style-options-block",
  ) as HTMLElement | null;
  const container = document.getElementById(
    "style-options",
  ) as HTMLElement | null;
  if (!block || !container) return;

  const hasOptions = optionParams.length > 0;
  block.hidden = !hasOptions;
  if (!hasOptions) {
    container.replaceChildren();
    optionPanel = null;
    optionsValid = true;
    return;
  }

  optionsValid = true;
  const values = { ...optionState.storedValues };
  optionDrafts.set(styleId, values);
  optionPanel = new ParameterPanel<StyleOptionParam>({
    container,
    controls: optionParams,
    values,
    // Same widgets as the style chooser, so the options of one style do not
    // change appearance between dialogs.
    mode: "xul",
    createXULElementCompat,
    getState: (control) =>
      optionState.states[control.id] ?? {
        mode: "free",
        value: optionState.effectiveValues[control.id] ?? "",
      },
    onChange: () => {
      const draft = optionDrafts.get(styleId);
      if (draft) {
        optionState = resolveStyleOptionState(optionParams, draft);
      }
    },
    onValidityChange: (valid) => {
      optionsValid = valid;
    },
  });
  optionPanel.render();
}

function getCheckedValue<T extends string>(name: string): T | null {
  const checked = document.querySelector<HTMLInputElement>(
    `input[name="${name}"]:checked`,
  );
  return (checked?.value as T | undefined) ?? null;
}

async function onAccept(): Promise<void> {
  if (!io) return;
  // Re-entry guard: the button stays clickable while the output runs below.
  if (running) return;

  const menulist = document.getElementById(
    "style-select",
  ) as XULMenulistElement | null;
  if (!menulist || !menulist.value) {
    ztoolkit.getGlobal("alert")(t("create-output-error-no-style"));
    return;
  }
  // A freshly opened dialog can be accepted before the first load resolves;
  // wait for the selection that is actually on screen instead of swallowing
  // the keypress. The loop re-reads the menulist in case the user switches
  // styles while the previous load is still pending.
  while (optionsReadyStyleId !== menulist.value) {
    if (!menulist.value) {
      ztoolkit.getGlobal("alert")(t("create-output-error-no-style"));
      return;
    }
    const styleId = menulist.value;
    let ready = false;
    try {
      ready = await waitForStyleOptions(styleId);
    } catch (e) {
      log.error("等待样式选项加载失败", e);
    }
    if (!ready) {
      ztoolkit.getGlobal("alert")(t("create-output-error-options-unavailable"));
      return;
    }
  }
  // Waiting for options yielded; a second Accept may have started the run.
  if (running) return;

  const outputType = getCheckedValue<"citation" | "bibliography">(
    "output-type",
  );
  const outputFormat = getCheckedValue<"html" | "text">("output-format");
  const outputMethod = getCheckedValue<"clipboard" | "file">("output-method");

  if (!outputType || !outputFormat || !outputMethod) {
    ztoolkit.getGlobal("alert")(t("create-output-error-incomplete"));
    return;
  }
  if (optionPanel && (!optionsValid || !optionPanel.isValid())) {
    ztoolkit.getGlobal("alert")(t("create-output-error-invalid-options"));
    optionPanel.focusFirst();
    return;
  }

  const storedOptions = resolveStyleOptionState(
    optionParams,
    optionDrafts.get(menulist.value),
  ).storedValues;

  io.result = {
    styleId: menulist.value,
    styleOptions: storedOptions,
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
    log.error("保存输出设置失败", e);
  }

  running = true;
  const acceptButton = document.getElementById(
    "accept-button",
  ) as HTMLButtonElement | null;
  if (acceptButton) {
    acceptButton.disabled = true;
  }
  try {
    // Generation must finish while this window is still open; see `IO.render`.
    await io.render();
  } finally {
    running = false;
    window.close();
  }
}

function onCancel(): void {
  if (!io) return;
  io.result = null;
  window.close();
}
