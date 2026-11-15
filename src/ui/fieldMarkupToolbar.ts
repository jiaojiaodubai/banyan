/**
 * A small formatting toolbar that operates on a focused field input.
 *
 * Kept separate from `ItemFieldEditor`: the editor owns rows and composition,
 * the toolbar owns markup commands and selection handling. Multilingual and
 * Field Tagger can therefore share both without one importing the other.
 */
import { useL10n } from "../utils/locale";
import {
  clearFieldMarks,
  parseFieldMarkup,
  serializeFieldMarkup,
  toggleFieldMark,
  type FieldMark,
} from "../utils/fieldMarkup";

const t = useL10n(["fieldMarkup.ftl"]);

type MarkButton = {
  mark: FieldMark;
  button: HTMLButtonElement;
};

const BUTTONS: { mark: FieldMark; label: string; icon: string }[] = [
  { mark: "bold", label: "field-markup-bold", icon: "bold.svg" },
  { mark: "italic", label: "field-markup-italic", icon: "italic.svg" },
  {
    mark: "superscript",
    label: "field-markup-superscript",
    icon: "superscript.svg",
  },
  { mark: "subscript", label: "field-markup-subscript", icon: "subscript.svg" },
  {
    mark: "smallCaps",
    label: "field-markup-small-caps",
    icon: "small-caps.svg",
  },
  { mark: "noCase", label: "field-markup-no-case", icon: "no-case.svg" },
];

function findInput(
  target: Element | null,
): HTMLInputElement | HTMLTextAreaElement | null {
  return (
    target?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      "input, textarea",
    ) ?? null
  );
}

function rawRangeForVisible(
  serialized: string,
  start: number,
  end: number,
): [number, number] | null {
  const parsed = parseFieldMarkup(serialized);
  if (parsed.error) return null;
  let rawStart = serialized.length;
  let rawEnd = 0;
  for (const run of parsed.runs) {
    if (run.visibleEnd <= start || run.visibleStart >= end) continue;
    rawStart = Math.min(rawStart, run.rawStart);
    rawEnd = Math.max(rawEnd, run.rawEnd);
  }
  return rawEnd > rawStart ? [rawStart, rawEnd] : null;
}

export class FieldMarkupToolbar {
  readonly element: HTMLDivElement;
  private _target: Element | null = null;
  private _buttons: MarkButton[] = [];
  private _clearButton: HTMLButtonElement;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "field-markup-toolbar";
    this.element.setAttribute("role", "toolbar");

    for (const item of BUTTONS) {
      const button = this.createButton(item.mark, t(item.label), item.icon);
      this.element.appendChild(button);
      this._buttons.push({ mark: item.mark, button });
    }

    this.element.appendChild(this.createDivider());

    this._clearButton = this.createButton(
      "clear",
      t("field-markup-clear"),
      "remove-format.svg",
    );
    this._clearButton.addEventListener("mousedown", (event) =>
      event.preventDefault(),
    );
    this._clearButton.addEventListener("click", () => this.clear());
    this.element.appendChild(this._clearButton);
    this.updateDisabled();
  }

  setTarget(target: Element | null): void {
    this._target = target;
    this.updateDisabled();
  }

  destroy(): void {
    this._target = null;
    this.element.remove();
  }

  private createButton(
    mark: FieldMark | "clear",
    label: string,
    icon: string,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "field-markup-button";
    button.dataset.mark = mark;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.style.backgroundImage = `url("chrome://${addon.data.config.addonRef}/content/icons/${icon}")`;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    if (mark !== "clear") {
      button.addEventListener("click", () => this.apply(mark));
    }
    return button;
  }

  private createDivider(): HTMLSpanElement {
    const divider = document.createElement("span");
    divider.className = "field-markup-divider";
    divider.setAttribute("aria-hidden", "true");
    return divider;
  }

  private updateDisabled(): void {
    const disabled = !findInput(this._target);
    for (const { button } of this._buttons) button.disabled = disabled;
    this._clearButton.disabled = disabled;
  }

  private apply(mark: FieldMark): void {
    const input = findInput(this._target);
    if (!input) return;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;
    if (start === end) return;

    const parsed = parseFieldMarkup(input.value);
    if (parsed.error) return;
    const nextRuns = toggleFieldMark(parsed.runs, [start, end], mark);
    const serialized = serializeFieldMarkup(nextRuns);
    const selection = rawRangeForVisible(serialized, start, end);
    input.value = serialized;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    if (selection) input.setSelectionRange(selection[0], selection[1]);
    input.focus();
  }

  private clear(): void {
    const input = findInput(this._target);
    if (!input) return;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;
    if (start === end) return;
    const parsed = parseFieldMarkup(input.value);
    if (parsed.error) return;
    const nextRuns = clearFieldMarks(parsed.runs, [start, end]);
    const serialized = serializeFieldMarkup(nextRuns);
    input.value = serialized;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  }
}
