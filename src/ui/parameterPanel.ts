/**
 * Render one scalar parameter and one whole scope.
 *
 * Declarations say whether a parameter is a closed state or an open value;
 * the panel derives the widget, applies the host's free/hidden/forced mode,
 * and shows the validation the core resolved into `ParamState`. It never calls
 * a style validator itself: that would run style code twice and let a throwing
 * validator escape into the render path. Lists are rendered by the cite popup,
 * since only `CITE_PARAMS` may contain them.
 */
import type {
  CitationParam,
  CiteParam,
  StyleOptionParam,
} from "@banyan/core/types/style";
import type { ParamState } from "@banyan/core/validation/paramValues";
import { openRichTextDialog } from "./richTextDialog";
import { richTextFromMarkup } from "./richTextMarkup";
import { renderRichTextToFragment } from "./richTextFragment";
import { useL10n } from "../utils/locale";

const t = useL10n(["citationDialog.ftl"]);

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

/**
 * Create a XUL element in a window whose document is XHTML.
 *
 * `document.createXULElement` exists in chrome documents; the namespace
 * fallback keeps the helper usable from a plain XML document as well.
 */
export function createXULElementCompat(tag: string): Element {
  const xulDocument = document as Document & {
    createXULElement?: (name: string) => Element;
  };
  if (typeof xulDocument.createXULElement === "function") {
    return xulDocument.createXULElement(tag);
  }
  return document.createElementNS(XUL_NS, tag);
}

/** Report a control error without taking permanent space in the layout. */
export function showValidationError(message: string, owner = window): void {
  if (!message) return;
  const title = t("citation-dialog-invalid-input");
  // `Prompt.confirm()` renders the question icon; a validation failure is a
  // warning, so use the alert prompt instead.
  Services.prompt.alert(owner as unknown as mozIDOMWindowProxy, title, message);
  owner.focus?.();
}

export type ParameterControl = Exclude<
  StyleOptionParam | CitationParam | CiteParam,
  { kind: "list" }
>;
export type ScalarValue = string | boolean;
export type ParameterFieldMode = "html" | "xul";

type XULCheckboxLike = Element & { checked: boolean };
type XULMenulistLike = Element & { value: string };

export type ParameterFieldOptions = {
  control: ParameterControl;
  /** Persisted/default value. */
  value: ScalarValue;
  state: ParamState;
  mode?: ParameterFieldMode;
  createXULElementCompat?: (tag: string) => Element;
  onChange: (value: ScalarValue) => void;
};

export type ParameterFieldHandle = {
  readonly element: HTMLElement;
  getValue(): ScalarValue;
  getError(): string;
  /** `state.validation` is the only source of the error text. */
  refresh(state: ParamState): void;
};

export function parameterDefaultValue(control: ParameterControl): ScalarValue {
  if (control.kind === "state") {
    if (control.states) {
      return String(
        control.defaultValue ?? Object.keys(control.states)[0] ?? "",
      );
    }
    return typeof control.defaultValue === "boolean"
      ? control.defaultValue
      : false;
  }
  return String(control.defaultValue ?? "");
}

export function initialParameterValue(
  control: ParameterControl,
  current: unknown,
): ScalarValue {
  if (control.kind === "state") {
    if (control.states) {
      return typeof current === "string" &&
        Object.hasOwn(control.states, current)
        ? current
        : parameterDefaultValue(control);
    }
    return typeof current === "boolean"
      ? current
      : parameterDefaultValue(control);
  }
  return typeof current === "string" ? current : parameterDefaultValue(control);
}

export function createParameterField(
  options: ParameterFieldOptions,
): ParameterFieldHandle {
  const { control, mode = "html", createXULElementCompat, onChange } = options;

  let value = options.value;
  let state = options.state;
  let error = "";

  const field = document.createElement("div");
  field.classList.add("banyan-control-field");
  field.dataset.controlId = control.id;
  if (control.description) field.title = control.description;

  const body = document.createElement("div");
  body.classList.add("banyan-control-body");

  let announcedError = "";
  const announceError = () => {
    if (!error || error === announcedError) return;
    announcedError = error;
    showValidationError(error);
    body.querySelector<HTMLElement>("[id]")?.focus();
  };

  let updateDisplay: () => void = () => undefined;

  if (control.kind === "state" && !control.states) {
    const label = document.createElement("label");
    label.classList.add("banyan-control-checkbox");
    let checkbox: Element;
    if (mode === "xul") {
      requireXUL(createXULElementCompat);
      const el = createXULElementCompat("checkbox") as XULCheckboxLike;
      el.setAttribute("id", `opt-${control.id}`);
      el.setAttribute("native", "true");
      el.setAttribute("label", control.label);
      el.addEventListener("command", () => {
        if (state.mode !== "free") return;
        value = Boolean(el.checked);
        onChange(value);
        queueMicrotask(announceError);
      });
      checkbox = el;
      body.appendChild(el);
    } else {
      const el = document.createElement("input");
      el.type = "checkbox";
      el.id = `opt-${control.id}`;
      el.addEventListener("change", () => {
        if (state.mode !== "free") return;
        value = Boolean(el.checked);
        onChange(value);
        queueMicrotask(announceError);
      });
      const text = document.createElement("span");
      text.textContent = control.label;
      label.append(el, text);
      checkbox = el;
      body.appendChild(label);
    }

    updateDisplay = () => {
      const forced =
        state.mode === "forced" ? Boolean(state.value) : Boolean(value);
      (checkbox as XULCheckboxLike).checked = forced;
      setElementDisabled(checkbox, state.mode !== "free");
    };
  } else if (control.kind === "state" && control.states) {
    const label = document.createElement("label");
    label.classList.add("banyan-control-label");
    label.textContent = control.label;
    label.setAttribute("for", `opt-${control.id}`);

    const states = control.states;
    let select: Element;
    const setDisplayValue = (next: string) => {
      if (mode === "xul") {
        const el = select as XULMenulistLike;
        el.value = next;
        el.setAttribute("value", next);
      } else {
        (select as HTMLSelectElement).value = next;
      }
    };

    if (mode === "xul") {
      requireXUL(createXULElementCompat);
      const el = createXULElementCompat("menulist") as XULMenulistLike;
      el.setAttribute("id", `opt-${control.id}`);
      el.setAttribute("native", "true");
      const menupopup = createXULElementCompat("menupopup");
      for (const [key, text] of Object.entries(states)) {
        const menuitem = createXULElementCompat("menuitem");
        menuitem.setAttribute("value", key);
        menuitem.setAttribute("label", text);
        menupopup.appendChild(menuitem);
      }
      el.appendChild(menupopup);
      el.addEventListener("command", () => {
        if (state.mode !== "free") return;
        value = String(el.value ?? "");
        onChange(value);
        queueMicrotask(announceError);
      });
      select = el;
    } else {
      const el = document.createElement("select");
      el.id = `opt-${control.id}`;
      for (const [key, text] of Object.entries(states)) {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = text;
        el.appendChild(option);
      }
      el.addEventListener("change", () => {
        if (state.mode !== "free") return;
        value = el.value;
        onChange(value);
        queueMicrotask(announceError);
      });
      select = el;
    }

    body.append(label, select);
    updateDisplay = () => {
      const next = String(state.mode === "forced" ? state.value : value);
      if (
        !(select instanceof HTMLSelectElement) ||
        Object.hasOwn(states, next)
      ) {
        setDisplayValue(next);
      }
      setElementDisabled(select, state.mode !== "free");
    };
  } else if (control.kind === "value" && control.format === "rich") {
    const label = document.createElement("label");
    label.classList.add("banyan-control-label");
    label.textContent = control.label;
    label.setAttribute("for", `opt-${control.id}`);

    const rich = document.createElement("div");
    rich.classList.add("banyan-control-rich");
    const preview = document.createElement("div");
    preview.id = `opt-${control.id}`;
    preview.classList.add("banyan-control-rich-preview");
    preview.tabIndex = 0;
    preview.setAttribute("role", "button");
    preview.setAttribute("aria-label", t("citation-dialog-edit-rich"));

    const renderPreview = (markup: string) => {
      const current = richTextFromMarkup(markup);
      preview.replaceChildren();
      if (!current.text) {
        // The preview is a div, so it has no native placeholder: draw one with
        // the same color as an input's placeholder instead of dimming the box.
        preview.classList.add("is-empty");
        preview.dataset.placeholder = t("citation-dialog-rich-empty");
        return;
      }
      preview.classList.remove("is-empty");
      delete preview.dataset.placeholder;
      preview.appendChild(renderRichTextToFragment(current));
    };

    const openEditor = () => {
      if (state.mode !== "free") return;
      openRichTextDialog({
        value: String(value),
        title: control.label,
        onCommit: (markup) => {
          value = markup;
          renderPreview(markup);
          onChange(value);
          queueMicrotask(announceError);
        },
      });
    };
    preview.addEventListener("click", openEditor);
    preview.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openEditor();
    });

    rich.append(preview);
    body.append(label, rich);
    updateDisplay = () => {
      const next = String(state.mode === "forced" ? state.value : value);
      renderPreview(next);
      const disabled = state.mode !== "free";
      preview.tabIndex = disabled ? -1 : 0;
      preview.setAttribute("aria-disabled", String(disabled));
      rich.classList.toggle("is-disabled", disabled);
    };
    renderPreview(String(value));
  } else {
    const input = document.createElement("input");
    input.type = "text";
    input.id = `opt-${control.id}`;
    input.classList.add("banyan-control-input");
    input.autocomplete = "off";
    const label = document.createElement("label");
    label.classList.add("banyan-control-label");
    label.textContent = control.label;
    label.setAttribute("for", `opt-${control.id}`);

    if (control.kind === "value" && control.presets?.length) {
      const listID = `banyan-presets-${control.id}`;
      const datalist = document.createElement("datalist");
      datalist.id = listID;
      for (const preset of control.presets) {
        const option = document.createElement("option");
        option.value = typeof preset === "string" ? preset : preset.value;
        option.label = typeof preset === "string" ? preset : preset.label;
        datalist.appendChild(option);
      }
      input.setAttribute("list", listID);
      body.append(label, input, datalist);
    } else {
      body.append(label, input);
    }
    input.addEventListener("input", () => {
      if (state.mode !== "free") return;
      value = input.value;
      onChange(value);
    });
    input.addEventListener("change", announceError);
    input.addEventListener("blur", announceError);

    updateDisplay = () => {
      const next = String(state.mode === "forced" ? state.value : value);
      if (input.value !== next) input.value = next;
      setElementDisabled(input, state.mode !== "free");
    };
  }

  const runValidate = (): string => {
    if (state.mode !== "free" || !state.validation) return "";
    if (state.validation.valid) return "";
    return state.validation.message || t("citation-dialog-invalid-input");
  };

  const applyError = () => {
    const controlEl = body.querySelector("[id]");
    if (controlEl) {
      if (error) {
        controlEl.setAttribute("aria-invalid", "true");
      } else {
        controlEl.removeAttribute("aria-invalid");
      }
    }
    if (!error) announcedError = "";
    field.title = error || control.description || "";
  };

  const refresh = (next: ParamState) => {
    state = next;
    field.hidden = state.mode === "hidden";
    updateDisplay();
    error = runValidate();
    applyError();
  };

  field.append(body);
  refresh(state);

  return {
    element: field,
    getValue: () => value,
    getError: () => error,
    refresh,
  };
}

export function setElementDisabled(element: Element, disabled: boolean): void {
  const control = element as Element & { disabled?: boolean };
  if ("disabled" in control) {
    control.disabled = disabled;
  }
  if (disabled) {
    element.setAttribute("disabled", "true");
  } else {
    element.removeAttribute("disabled");
  }
}

export type ParameterPanelOptions<
  T extends ParameterControl = ParameterControl,
> = {
  container: HTMLElement;
  controls: readonly T[];
  /** Stored values, updated in place when the user edits a free field. */
  values: Record<string, ScalarValue>;
  mode?: ParameterFieldMode;
  createXULElementCompat?: (tag: string) => Element;
  /** Must carry `validation` for a free value; the panel never runs validators. */
  getState: (control: T) => ParamState;
  onChange: (control: T, value: ScalarValue) => void;
  onValidityChange?: (valid: boolean) => void;
};

/**
 * One panel for a whole scope. Re-reads `getState` and validation on every
 * change; bursts of input are coalesced into one refresh.
 */
export class ParameterPanel<T extends ParameterControl = ParameterControl> {
  private readonly options: ParameterPanelOptions<T>;
  private readonly fields = new Map<string, ParameterFieldHandle>();
  private valid = true;
  private refreshPending = false;

  constructor(options: ParameterPanelOptions<T>) {
    this.options = options;
  }

  render(): void {
    const { container, controls, mode, createXULElementCompat, onChange } =
      this.options;
    container.replaceChildren();
    this.fields.clear();

    for (const control of controls) {
      const handle = createParameterField({
        control,
        value: initialParameterValue(control, this.options.values[control.id]),
        state: this.options.getState(control),
        mode,
        createXULElementCompat,
        onChange: (value) => {
          this.options.values[control.id] = value;
          onChange(control, value);
          this.scheduleRefresh();
        },
      });
      this.fields.set(control.id, handle);
      container.appendChild(handle.element);
    }

    this.refresh();
  }

  refresh(): void {
    const { controls, getState, onValidityChange } = this.options;
    let valid = true;
    for (const control of controls) {
      const handle = this.fields.get(control.id);
      if (!handle) continue;
      handle.refresh(getState(control));
      if (handle.getError()) valid = false;
    }
    if (valid !== this.valid) {
      this.valid = valid;
      onValidityChange?.(valid);
    }
  }

  isValid(): boolean {
    return this.valid;
  }

  setControls(controls: readonly T[]): void {
    const previousIds = this.options.controls.map((control) => control.id);
    const nextIds = controls.map((control) => control.id);
    this.options.controls = controls;
    if (
      previousIds.length !== nextIds.length ||
      previousIds.some((id, index) => id !== nextIds[index])
    ) {
      this.render();
      return;
    }
    this.refresh();
  }

  get values(): Record<string, ScalarValue> {
    return this.options.values;
  }

  focusFirst(): void {
    const first = this.options.container.querySelector<HTMLElement>(
      "input, select, textarea, button",
    );
    first?.focus();
  }

  focusFirstInvalid(): boolean {
    for (const control of this.options.controls) {
      const handle = this.fields.get(control.id);
      if (!handle) continue;
      const message = handle.getError();
      if (!message) continue;
      showValidationError(message);
      const target = handle.element.querySelector<HTMLElement>(
        '[aria-invalid="true"], input, select, textarea, button, [role="button"]',
      );
      target?.focus();
      target?.scrollIntoView({ block: "nearest" });
      return true;
    }
    return false;
  }

  private scheduleRefresh(): void {
    if (this.refreshPending) return;
    this.refreshPending = true;
    queueMicrotask(() => {
      this.refreshPending = false;
      this.refresh();
    });
  }
}

function requireXUL(
  createXULElementCompat: ((tag: string) => Element) | undefined,
): asserts createXULElementCompat is (tag: string) => Element {
  if (!createXULElementCompat) {
    throw new Error("createXULElementCompat is required in xul mode");
  }
}
