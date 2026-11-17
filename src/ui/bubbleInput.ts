import type {
  CitationContext,
  CitationParams,
  Cite,
  CiteParam,
  ListFieldParam,
  ListRow,
  ParamValue,
  StyleOptionValues,
} from "@banyan/core/types/style";
import {
  resolveCiteParamValues,
  type ParamState,
  type ResolvedCite,
} from "@banyan/core/validation/paramValues";
import { getItemDisplayLabel } from "@banyan/core/items/fields";
import {
  createParameterField,
  createXULElementCompat,
  initialParameterValue,
  setElementDisabled,
  showValidationError,
  type ParameterFieldHandle,
  type ScalarValue,
} from "./parameterPanel";
import { openRichTextDialog } from "./richTextDialog";
import { richTextFromMarkup } from "./richTextMarkup";
import { renderRichTextToFragment } from "./richTextFragment";
import { useL10n } from "../utils/locale";

const t = useL10n(["citationDialog.ftl"]);

export interface BubbleInputDelegate {
  onSearch: (query: string) => void;
  onCitesChanged: (cites: Cite[]) => void;
  onConfirm?: () => void;
  onDropItemIDs?: (itemIDs: number[], insertIndex: number) => void;
}

export type BubbleInputContext = {
  /** Citation params, read by cite predicates (the popup edits one cite). */
  getCitationParams?: () => CitationParams;
  /** Effective document-wide options, read by cite predicates. */
  getStyleOptions?: () => StyleOptionValues;
};

type ParameterAtomControl = Exclude<CiteParam, { kind: "list" }>;

type PopupAtomField = {
  control: ParameterAtomControl;
  handle: ParameterFieldHandle;
};

type PopupListField = {
  field: ListFieldParam;
  row: ListRow;
  /** Position of `row` in the resolved list, used to read fieldValidation. */
  rowIndex: number;
  getValue: () => ScalarValue;
  getError: () => string;
  setError: (text: string) => void;
};

type PopupListEditor = {
  control: Extract<CiteParam, { kind: "list" }>;
  element: HTMLElement;
  refresh: (
    state: ParamState,
    validation?: ParamState["fieldValidation"],
  ) => void;
};

function listRowsFromState(
  control: Extract<CiteParam, { kind: "list" }>,
  state: ParamState,
): Record<string, string>[] {
  const raw = Array.isArray(state.value) ? state.value : [];
  return raw.map((entry) => {
    const row = entry as ListRow;
    const next: Record<string, string> = {};
    for (const field of control.fields) {
      next[field.id] = String(row[field.id] ?? field.defaultValue ?? "");
    }
    return next;
  });
}

function sameRows(a: readonly ListRow[], b: readonly ListRow[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((row, index) => {
    const other = b[index];
    if (!other) return false;
    const keys = new Set([...Object.keys(row), ...Object.keys(other)]);
    for (const key of keys) {
      if (row[key] !== other[key]) return false;
    }
    return true;
  });
}

/** The caret to put back after a list editor rebuilds its rows. */
type ListCellFocus = {
  rowIndex: string;
  fieldId: string;
  selectionStart: number | null;
  selectionEnd: number | null;
};

function captureListCellFocus(container: HTMLElement): ListCellFocus | null {
  const active = document.activeElement;
  if (
    !(active instanceof HTMLElement) ||
    !container.contains(active) ||
    !active.dataset.banyanFieldId
  ) {
    return null;
  }
  const input = active as HTMLInputElement;
  return {
    rowIndex: active.dataset.banyanRowIndex ?? "",
    fieldId: active.dataset.banyanFieldId,
    selectionStart:
      typeof input.selectionStart === "number" ? input.selectionStart : null,
    selectionEnd:
      typeof input.selectionEnd === "number" ? input.selectionEnd : null,
  };
}

/**
 * Put the user back into the cell they were typing in. `render()` replaces the
 * inputs, so the browser otherwise drops focus and the rest of the word.
 */
function restoreListCellFocus(
  container: HTMLElement,
  focus: ListCellFocus | null,
): void {
  if (!focus) return;
  const target = Array.from(
    container.querySelectorAll("[data-banyan-field-id]"),
  ).find(
    (element) =>
      element instanceof HTMLElement &&
      element.dataset.banyanRowIndex === focus.rowIndex &&
      element.dataset.banyanFieldId === focus.fieldId,
  );
  if (!(target instanceof HTMLElement)) return;
  if (
    (target instanceof HTMLInputElement && target.disabled) ||
    (!(target instanceof HTMLInputElement) &&
      target.getAttribute("aria-disabled") === "true")
  ) {
    return;
  }
  target.focus({ preventScroll: true });
  if (target instanceof HTMLInputElement && focus.selectionStart !== null) {
    const length = target.value.length;
    const start = Math.min(focus.selectionStart, length);
    const end = Math.min(focus.selectionEnd ?? start, length);
    target.setSelectionRange(start, end);
  }
}

export class BubbleInput {
  private container: HTMLElement;
  private delegate: BubbleInputDelegate;
  private context: BubbleInputContext;
  private cites: Cite[] = [];
  private citeControls: CiteParam[];
  private body: HTMLDivElement;
  private lastFocusedInput: HTMLInputElement | null = null;
  private popup: HTMLElement | null = null;
  private popupAnchor: HTMLElement | null = null;
  private popupCite: Cite | null = null;

  private popupFields: PopupAtomField[] = [];
  private popupListEditors: PopupListEditor[] = [];
  private popupRefreshPending = false;
  private measureSpan: HTMLSpanElement | null = null;

  private bubbleElements: HTMLElement[] = [];
  private inputElements: HTMLInputElement[] = [];

  private caretIndicator: HTMLDivElement | null = null;
  private dropIndicator: HTMLDivElement | null = null;

  private readonly GAP_INDICATOR_HEIGHT = 14;
  private readonly GAP_INDICATOR_WIDTH = 1;

  private draggingBubbleIndex: number | null = null;
  private dragOverBubbleIndex: number | null = null;
  private dragOverInsertAfter: boolean = false;
  private ignoreNextBubbleClick: boolean = false;

  private elideMiddle(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    if (maxChars <= 1) return "…";
    const left = Math.ceil((maxChars - 1) / 2);
    const right = Math.floor((maxChars - 1) / 2);
    return `${text.slice(0, left)}…${text.slice(text.length - right)}`;
  }

  constructor(
    container: HTMLElement,
    citeControls: CiteParam[],
    delegate: BubbleInputDelegate,
    context: BubbleInputContext = {},
  ) {
    this.container = container;
    this.citeControls = citeControls;
    this.delegate = delegate;
    this.context = context;

    this.container.classList.add("bubble-input-container");
    this.container.replaceChildren();

    this.body = document.createElement("div");
    this.body.classList.add("bubble-input-body");
    this.body.setAttribute("spellcheck", "false");
    this.body.setAttribute("role", "application");
    this.container.appendChild(this.body);

    const focusNearestInputFromPoint = (clientX: number, clientY: number) => {
      const lastBubble = this.getLastBubbleBeforePoint(clientX, clientY);
      if (lastBubble) {
        const next = lastBubble.nextElementSibling;
        if (next && this.isInput(next)) {
          (next as HTMLInputElement).focus();
          return;
        }
      }
      const first = this.body.firstElementChild;
      if (first && this.isInput(first)) {
        (first as HTMLInputElement).focus();
      }
    };

    // Click on empty space should focus the nearest input (after the last bubble before point)
    const onContainerClick = (e: MouseEvent) => {
      const path = (e.composedPath?.() ?? []) as unknown[];
      const clickedBubble = path.some(
        (n) => n instanceof Element && n.classList.contains("bubble"),
      );
      const clickedInput = path.some(
        (n) => n instanceof Element && this.isInput(n),
      );
      if (clickedBubble || clickedInput) return;
      focusNearestInputFromPoint(e.clientX, e.clientY);
    };

    this.container.addEventListener("click", (e: MouseEvent) =>
      onContainerClick(e),
    );

    // Close popup when clicking outside
    document.addEventListener("click", (e: MouseEvent) => {
      if (
        this.popup &&
        !this.popup.contains(e.target as Node) &&
        !this.container.contains(e.target as Node)
      ) {
        this.closePopup();
      }
    });

    // Treat "popup loses focus" as confirm (close it).
    document.addEventListener(
      "focusin",
      (e: FocusEvent) => {
        if (!this.popup) return;
        const target = e.target as Node | null;
        if (
          target &&
          (this.popup.contains(target) || this.popupAnchor?.contains(target))
        ) {
          return;
        }
        this.closePopup();
      },
      true,
    );

    // Initial DOM
    this.render();

    // Drop-to-end support: if user drops on empty space inside the bubble input,
    // move the dragged bubble to the end.
    this.body.addEventListener("dragover", (e: DragEvent) => {
      const draggedItemIDs = this.getDraggedItemIDs(e.dataTransfer);
      if (this.draggingBubbleIndex == null && !draggedItemIDs.length) return;
      e.preventDefault();

      // If dragging over empty area (not directly over a bubble), show the
      // insertion indicator at the last gap.
      const path = (e.composedPath?.() ?? []) as unknown[];
      const overBubble = path.some(
        (n) => n instanceof Element && n.classList.contains("bubble"),
      );
      if (!overBubble) {
        const bubbles = this.getBubbleElements();
        const lastIndex = bubbles.length - 1;
        if (lastIndex >= 0) {
          this.showDropIndicatorFor(lastIndex, true);
        } else {
          this.hideGapIndicator("drop");
        }
      }

      try {
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect =
            this.draggingBubbleIndex == null ? "copy" : "move";
        }
      } catch {
        // ignore
      }
    });

    this.body.addEventListener("drop", (e: DragEvent) => {
      const draggedItemIDs = this.getDraggedItemIDs(e.dataTransfer);
      if (this.draggingBubbleIndex == null && !draggedItemIDs.length) return;
      // If dropping directly on a bubble, that bubble handler will run.
      const path = (e.composedPath?.() ?? []) as unknown[];
      const droppedOnBubble = path.some(
        (n) => n instanceof Element && n.classList.contains("bubble"),
      );
      if (droppedOnBubble) return;

      e.preventDefault();
      e.stopPropagation();

      if (draggedItemIDs.length) {
        const insertIndex = this.getDropInsertIndex(e.clientX, e.clientY);
        this.delegate.onDropItemIDs?.(draggedItemIDs, insertIndex);
        this.hideGapIndicator("drop");
        return;
      }

      const from = this.draggingBubbleIndex;
      if (from == null) return;
      const to = this.cites.length - 1;
      this.moveCite(from, to);
      this.clearDragState();
    });
  }

  public get Cites() {
    return this.cites;
  }

  public get SearchText(): string {
    return this.getCurrentInput()?.value ?? "";
  }

  public focus(): void {
    this.refocusInput();
  }

  public refocusInput(): HTMLInputElement | null {
    let input = this.getCurrentInput();
    const allInputs = this.getAllInputs();

    input ??= allInputs.find((inp) => inp.value.length) ?? null;
    input ??= allInputs[allInputs.length - 1] ?? null;
    if (!input) return null;

    this.focusInput(input);
    return input;
  }

  public clearSearch(): void {
    const input = this.getCurrentInput();
    if (!input) return;
    input.value = "";
    this.updateInputWidth(input);
    this.delegate.onSearch("");
  }

  /** Refresh the open cite popup after a citation-scope control changed. */
  public refreshOpenPopup(): void {
    if (!this.popupCite) return;
    this.schedulePopupRefresh(this.popupCite);
  }

  /**
   * Re-check every stored cite param, including popups that are closed.
   *
   * The citation dialog calls this before accepting: an invalid value must not
   * disappear just because its popup was closed.
   */
  public validateAll(): boolean {
    let allValid = true;
    const bubbles = this.getBubbleElements();
    this.cites.forEach((cite, index) => {
      const valid = this.isCiteValid(cite);
      allValid &&= valid;
      const bubble = bubbles[index];
      if (bubble) {
        bubble.classList.toggle("is-invalid", !valid);
        bubble.setAttribute("aria-invalid", String(!valid));
      }
    });
    return allValid;
  }

  /** Open the first invalid popup and focus its control. */
  public focusFirstInvalid(): boolean {
    const bubbles = this.getBubbleElements();
    for (let index = 0; index < this.cites.length; index += 1) {
      const cite = this.cites[index];
      if (this.isCiteValid(cite)) continue;
      const bubble = bubbles[index];
      if (!bubble) continue;
      const message = this.firstCiteError(cite);
      if (message) showValidationError(message);
      this.showPopup(cite, bubble);
      window.setTimeout(() => {
        const target = this.popup?.querySelector<HTMLElement>(
          '[aria-invalid="true"], input, select, textarea, button, [role="button"]',
        );
        target?.focus();
        target?.scrollIntoView({ block: "nearest" });
      }, 0);
      return true;
    }
    return false;
  }

  private firstCiteError(cite: Cite): string {
    const resolved = this.resolveCite(cite);
    for (const control of this.citeControls) {
      const state = resolved.states[control.id];
      if (!state || state.mode !== "free") continue;
      const fallback = t("citation-dialog-invalid-input");
      if (control.kind === "list") {
        for (const rows of Object.values(state.fieldValidation ?? {})) {
          const invalid = rows.find(
            (entry) => !entry.valid && entry.source !== "default",
          );
          if (invalid) return invalid.message || fallback;
        }
        continue;
      }
      if (state.validation && !state.validation.valid) {
        return state.validation.message || fallback;
      }
    }
    return "";
  }

  private isCiteValid(cite: Cite): boolean {
    return !this.firstCiteError(cite);
  }

  public setCites(cites: Cite[], options?: { notify?: boolean }): void {
    this.cites = [...cites];
    this.render();
    if (options?.notify ?? true) {
      this.delegate.onCitesChanged(this.cites);
    }
  }

  public addCite(
    cite: Cite,
    options?: {
      index?: number;
      preserveSearch?: boolean;
      focusAfter?: boolean;
    },
  ) {
    const itemID = cite.item.id;
    if (this.cites.some((c) => c.item.id === itemID)) {
      if (!(options?.preserveSearch ?? false)) {
        this.clearSearch();
      }
      return;
    }
    if (!cite.params) {
      cite.params = {};
    }

    const insertIndex =
      options?.index == null
        ? this.cites.length
        : Math.max(0, Math.min(this.cites.length, options.index));
    if (!(options?.preserveSearch ?? false)) {
      this.clearSearch();
    }
    this.cites.splice(insertIndex, 0, cite);
    this.render();

    this.delegate.onCitesChanged(this.cites);

    if (options?.focusAfter ?? true) {
      // Focus the input after the inserted bubble so user can continue typing
      this.focusInputAfterBubble(insertIndex);
    }
  }

  public removeCite(cite: Cite) {
    const index = this.cites.indexOf(cite);
    if (index > -1) {
      this.cites.splice(index, 1);
      this.render();
      this.delegate.onCitesChanged(this.cites);
    }
  }

  /**
   * Return the index where a newly added bubble should be inserted.
   * Equivalent to Zotero's bubble-input.getFutureBubbleIndex().
   */
  public getFutureBubbleIndex(): number {
    const input = this.getCurrentInput();
    if (!input) return this.cites.length;
    let bubbleCount = 0;
    for (const child of Array.from(this.body.children)) {
      if (child === input) {
        return bubbleCount;
      }
      if (child.classList.contains("bubble")) {
        bubbleCount++;
      }
    }
    return bubbleCount;
  }

  private render() {
    // Focus is restored only when it was already inside; an outside consumer
    // such as ItemTree keeps it.
    const hadFocusInside = this.body.contains(document.activeElement);
    const active = hadFocusInside ? this.getCurrentInput() : null;
    const activeInputIndex = active ? this.inputElements.indexOf(active) : -1;
    this.body.replaceChildren();

    // Refresh element caches (used by drag/keyboard hot paths)
    this.bubbleElements = [];
    this.inputElements = [];

    // First input
    const firstInput = this.createInputElem();
    this.inputElements.push(firstInput);
    this.body.appendChild(firstInput);

    // Bubble + trailing input for each cite
    for (let i = 0; i < this.cites.length; i++) {
      const cite = this.cites[i];
      const bubble = this.createBubble(cite, i);
      this.bubbleElements.push(bubble);
      this.body.appendChild(bubble);

      const input = this.createInputElem();
      this.inputElements.push(input);
      this.body.appendChild(input);
    }

    // Re-attach indicators (render() wipes body children)
    if (this.caretIndicator) this.body.appendChild(this.caretIndicator);
    if (this.dropIndicator) this.body.appendChild(this.dropIndicator);

    // The only input fills the row; widths follow the content.
    const isOnlyInput = this.cites.length === 0;
    const first = this.body.firstElementChild;
    if (first && this.isInput(first)) {
      first.classList.toggle("full-width", isOnlyInput);
    }

    for (const input of this.getAllInputs()) {
      this.updateInputWidth(input);
    }

    if (hadFocusInside) {
      const restoredInput =
        activeInputIndex >= 0
          ? this.inputElements[
              Math.min(activeInputIndex, this.inputElements.length - 1)
            ]
          : null;
      if (restoredInput) {
        this.focusInput(restoredInput);
      } else {
        this.refocusInput();
      }
    }

    // Refresh caret indicator after layout changes
    this.updateCenteredCaretIndicator();
  }

  private ensureGapIndicator(kind: "caret" | "drop"): HTMLDivElement {
    const existing =
      kind === "caret" ? this.caretIndicator : this.dropIndicator;
    if (existing) return existing;

    const el = document.createElement("div");
    el.classList.add(
      "bubble-gap-indicator",
      kind === "caret" ? "is-caret" : "is-drop",
      "is-hidden",
    );
    el.setAttribute("aria-hidden", "true");
    this.body.appendChild(el);

    if (kind === "caret") this.caretIndicator = el;
    else this.dropIndicator = el;
    return el;
  }

  private hideGapIndicator(kind: "caret" | "drop"): void {
    const el = kind === "caret" ? this.caretIndicator : this.dropIndicator;
    el?.classList.add("is-hidden");
  }

  private positionGapIndicator(
    kind: "caret" | "drop",
    clientX: number,
    clientY: number,
  ): void {
    const el = this.ensureGapIndicator(kind);
    const bodyRect = this.body.getBoundingClientRect();

    // Use sub-pixel + device-pixel snapping to avoid jitter/rounding bias.
    // Also center the 1px indicator on the target X (instead of placing its
    // left edge at X, which always looks slightly shifted right).
    const halfH = this.GAP_INDICATOR_HEIGHT / 2;
    const halfW = this.GAP_INDICATOR_WIDTH / 2;

    const rawTop = clientY - bodyRect.top - halfH;
    const rawLeft = clientX - bodyRect.left - halfW;

    const maxTop = Math.max(0, bodyRect.height - this.GAP_INDICATOR_HEIGHT);
    const maxLeft = Math.max(0, bodyRect.width - this.GAP_INDICATOR_WIDTH);

    const top = this.snapToDevicePixel(Math.max(0, Math.min(rawTop, maxTop)));
    const left = this.snapToDevicePixel(
      Math.max(0, Math.min(rawLeft, maxLeft)),
    );

    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    el.classList.remove("is-hidden");
  }

  private snapToDevicePixel(value: number): number {
    const dpr = window.devicePixelRatio || 1;
    return Math.round(value * dpr) / dpr;
  }

  private isSameVisualLine(a: DOMRect, b: DOMRect): boolean {
    const aMid = (a.top + a.bottom) / 2;
    const bMid = (b.top + b.bottom) / 2;
    return (
      (aMid >= b.top && aMid <= b.bottom) || (bMid >= a.top && bMid <= a.bottom)
    );
  }

  private rectMidY(r: DOMRect): number {
    return (r.top + r.bottom) / 2;
  }

  private showGapIndicator(
    kind: "caret" | "drop",
    options: {
      left?: HTMLElement | null;
      right?: HTMLElement | null;
      fallback?: HTMLElement | null;
      crossLine?: "edge-before-right" | "use-fallback-line";
    },
  ): void {
    const left = options.left ?? null;
    const right = options.right ?? null;
    const fallback = options.fallback ?? null;

    const getMarginPx = (el: HTMLElement, side: "left" | "right"): number => {
      const style = window.getComputedStyle?.(el) ?? null;
      const raw = side === "left" ? style?.marginLeft : style?.marginRight;
      const n = raw ? Number.parseFloat(raw) : NaN;
      return Number.isFinite(n) ? n : 0;
    };

    const showEdge = (bubble: HTMLElement, edge: "before" | "after"): void => {
      const r = bubble.getBoundingClientRect();
      const margin = getMarginPx(bubble, edge === "before" ? "left" : "right");
      const x = edge === "before" ? r.left - margin : r.right + margin;
      const y = this.rectMidY(r);
      this.positionGapIndicator(kind, x, y);
    };

    if (left && right) {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();

      if (this.isSameVisualLine(leftRect, rightRect)) {
        const x = (leftRect.right + rightRect.left) / 2;
        const y = (this.rectMidY(leftRect) + this.rectMidY(rightRect)) / 2;
        this.positionGapIndicator(kind, x, y);
        return;
      }

      if (options.crossLine === "use-fallback-line" && fallback) {
        const fallbackRect = fallback.getBoundingClientRect();
        const onRightLine = this.isSameVisualLine(fallbackRect, rightRect);
        const onLeftLine = this.isSameVisualLine(fallbackRect, leftRect);

        if (onRightLine && !onLeftLine) {
          showEdge(right, "before");
          return;
        }
        if (onLeftLine && !onRightLine) {
          showEdge(left, "after");
          return;
        }
      }

      // Default cross-line behavior: treat it as the edge gap before the first
      // bubble on the next line, so the indicator doesn't hug the bubble.
      showEdge(right, "before");
      return;
    }

    if (left && !right) {
      showEdge(left, "after");
      return;
    }

    if (!left && right) {
      showEdge(right, "before");
      return;
    }

    this.hideGapIndicator(kind);
  }

  private updateCenteredCaretIndicator(): void {
    const input = this.getCurrentInput();
    if (!input) {
      this.hideGapIndicator("caret");
      return;
    }

    // Only show the centered caret indicator when the focused input is empty
    // AND sits between two bubbles. This removes the LTR/RTL visual bias.
    const isFocused = document.activeElement === input;
    const isEmpty = (input.value ?? "").length === 0;
    const prevEl = input.previousElementSibling;
    const nextEl = input.nextElementSibling;
    const prev =
      prevEl instanceof HTMLElement && prevEl.classList.contains("bubble")
        ? prevEl
        : null;
    const next =
      nextEl instanceof HTMLElement && nextEl.classList.contains("bubble")
        ? nextEl
        : null;

    if (isFocused && isEmpty && (prev || next)) {
      input.classList.add("centered-caret");
      this.showGapIndicator("caret", {
        left: prev,
        right: next,
        fallback: input,
        crossLine: "use-fallback-line",
      });
      return;
    }

    input.classList.remove("centered-caret");
    this.hideGapIndicator("caret");
  }

  private showDropIndicatorFor(
    targetIndex: number,
    insertAfter: boolean,
  ): void {
    const bubbles = this.getBubbleElements();
    const bubble = bubbles[targetIndex] ?? null;
    if (!bubble) {
      this.hideGapIndicator("drop");
      return;
    }

    const left = insertAfter ? bubble : (bubbles[targetIndex - 1] ?? null);
    const right = insertAfter ? (bubbles[targetIndex + 1] ?? null) : bubble;

    this.showGapIndicator("drop", {
      left,
      right,
      crossLine: "edge-before-right",
    });
  }

  private clearDragState(): void {
    this.draggingBubbleIndex = null;
    this.dragOverBubbleIndex = null;
    this.dragOverInsertAfter = false;
    this.body.classList.remove("is-dragging");
    this.hideGapIndicator("drop");
    for (const b of this.getBubbleElements()) {
      b.classList.remove("is-dragging");
    }

    // Restore caret indicator when drag finishes
    this.updateCenteredCaretIndicator();
  }

  private getBubbleElements(): HTMLElement[] {
    return this.bubbleElements;
  }

  private focusBubbleAtIndex(index: number): void {
    const bubbles = this.getBubbleElements();
    const el = bubbles[index] ?? null;
    el?.focus?.();
  }

  private moveCite(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= this.cites.length) return;

    const clampedTo = Math.max(0, Math.min(this.cites.length - 1, toIndex));
    const [moved] = this.cites.splice(fromIndex, 1);
    const insertIndex =
      fromIndex < clampedTo ? Math.max(0, clampedTo) : clampedTo;
    this.cites.splice(insertIndex, 0, moved);

    this.render();
    this.delegate.onCitesChanged(this.cites);
    this.focusBubbleAtIndex(insertIndex);
  }

  private handleBubbleDrop(targetIndex: number, insertAfter: boolean): void {
    const from = this.draggingBubbleIndex;
    if (from == null) return;

    let to = insertAfter ? targetIndex + 1 : targetIndex;
    if (from < to) {
      // Removing the dragged item shifts indices left.
      to -= 1;
    }
    to = Math.max(0, Math.min(this.cites.length - 1, to));

    this.moveCite(from, to);
  }

  private isInput(el: Element): boolean {
    return (
      el instanceof HTMLInputElement &&
      el.classList.contains("bubble-search-input")
    );
  }

  private getAllInputs(): HTMLInputElement[] {
    return this.inputElements;
  }

  private getCurrentInput(): HTMLInputElement | null {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && this.body.contains(active)) {
      if (active.classList.contains("bubble-search-input")) {
        return active;
      }
    }
    if (this.lastFocusedInput && this.body.contains(this.lastFocusedInput)) {
      return this.lastFocusedInput;
    }
    return null;
  }

  private createInputElem(): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "text";
    input.classList.add("bubble-search-input");
    input.autocomplete = "off";
    input.spellcheck = false;

    input.addEventListener("focus", () => {
      this.lastFocusedInput = input;
      this.updateCenteredCaretIndicator();
    });

    input.addEventListener("blur", () => {
      input.classList.remove("centered-caret");
      this.hideGapIndicator("caret");
    });

    input.addEventListener("input", () => {
      this.updateInputWidth(input);
      // Search uses the currently focused input only (matches Zotero behavior)
      this.delegate.onSearch(input.value);
      this.updateCenteredCaretIndicator();
    });

    input.addEventListener("keydown", (e: KeyboardEvent) => {
      e.stopPropagation();
      this.onInputKeydown(input, e);
      // Keep the centered indicator updated when navigating between inputs
      this.updateCenteredCaretIndicator();
    });

    return input;
  }

  private updateInputWidth(input: HTMLInputElement): void {
    // Match Zotero behavior: empty inputs occupy no width so bubbles don't
    // get misaligned at line starts; on focus CSS provides 1px width for caret.
    if (input.classList.contains("full-width")) {
      input.classList.remove("empty");
      input.style.width = "";
      return;
    }

    const value = input.value ?? "";
    if (!value) {
      input.classList.add("empty");
      input.style.width = "0px";
      return;
    }

    input.classList.remove("empty");
    const px = this.getContentWidth(input, value);
    input.style.width = `${px}px`;
  }

  private getContentWidth(input: HTMLInputElement, value: string): number {
    // Mirror Zotero Utils.getContentWidth(): measure rendered text width
    // using a temporary span with identical font metrics.
    const span = this.measureSpan ?? document.createElement("span");
    this.measureSpan = span;

    const style = window.getComputedStyle?.(input) ?? null;
    span.style.position = "absolute";
    span.style.visibility = "hidden";
    span.style.whiteSpace = "pre";
    span.style.font = style?.font ?? "";
    span.style.letterSpacing = style?.letterSpacing ?? "";
    span.style.textTransform = style?.textTransform ?? "";
    span.style.padding = "0";
    span.style.margin = "0";
    span.textContent = value;

    this.body.appendChild(span);
    const width = span.getBoundingClientRect().width;
    span.remove();
    // Use ceil to avoid clipping the last glyph/caret.
    return Math.max(1, Math.ceil(width));
  }

  private focusInput(input: HTMLInputElement): void {
    input.focus();
    const end = input.value.length;
    try {
      input.setSelectionRange(end, end);
    } catch {
      // ignore
    }
  }

  private focusInputAfterBubble(bubbleIndex: number): void {
    // DOM layout: input, (bubble, input) * n
    const childIndex = 2 * bubbleIndex + 2;
    const el = this.body.children.item(childIndex);
    if (el && this.isInput(el)) {
      this.focusInput(el as HTMLInputElement);
    }
  }

  private getLastBubbleBeforePoint(x: number, y: number): HTMLElement | null {
    let last: HTMLElement | null = null;
    for (const bubble of this.getBubbleElements()) {
      const r = bubble.getBoundingClientRect();
      // If click is below this bubble, it's a candidate; if on same line, compare x
      const isAboveLine = y > r.bottom;
      const isOnLineAndAfter = y >= r.top && y <= r.bottom && x > r.right;
      if (isAboveLine || isOnLineAndAfter) {
        last = bubble;
      }
    }
    return last;
  }

  private getDropInsertIndex(x: number, y: number): number {
    for (let index = 0; index < this.bubbleElements.length; index++) {
      const bubble = this.bubbleElements[index];
      const rect = bubble.getBoundingClientRect();
      const isWithinY = y >= rect.top && y <= rect.bottom;
      if (!isWithinY) {
        continue;
      }
      return x <= rect.left + rect.width / 2 ? index : index + 1;
    }

    const lastBubble = this.getLastBubbleBeforePoint(x, y);
    if (!lastBubble) {
      return 0;
    }

    const bubbleIndex = this.getBubbleElements().indexOf(lastBubble);
    return bubbleIndex < 0 ? this.cites.length : bubbleIndex + 1;
  }

  private getDraggedItemIDs(dataTransfer: DataTransfer | null): number[] {
    if (!dataTransfer) {
      return [];
    }

    const raw = dataTransfer.getData("zotero/item");
    if (!raw) {
      return [];
    }

    return raw
      .split(",")
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value));
  }

  private createBubble(cite: Cite, bubbleIndex: number): HTMLElement {
    const bubble = document.createElement("div");
    bubble.classList.add("bubble");
    bubble.setAttribute("role", "button");
    bubble.tabIndex = 0;
    bubble.draggable = true;
    bubble.dataset.bubbleIndex = String(bubbleIndex);
    // Author/date label with title fallback (same as style editor input).
    const label = getItemDisplayLabel(cite.item);
    const displayLabel = this.elideMiddle(label, 60);
    const text = document.createElement("span");
    text.classList.add("bubble-text");
    text.textContent = displayLabel;
    bubble.replaceChildren(text);
    bubble.title = cite.item.title || "Untitled";

    bubble.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.ignoreNextBubbleClick) {
        this.ignoreNextBubbleClick = false;
        return;
      }
      this.showPopup(cite, bubble);
    });

    bubble.addEventListener("keydown", (e: KeyboardEvent) => {
      e.stopPropagation();
      this.onBubbleKeydown(bubble, cite, e);
    });

    // Drag & drop reorder (matches Zotero-like bubble input behavior)
    bubble.addEventListener("dragstart", (e: DragEvent) => {
      e.stopPropagation();
      const index = Number.parseInt(bubble.dataset.bubbleIndex ?? "-1", 10);
      if (index < 0) return;
      this.draggingBubbleIndex = index;
      this.ignoreNextBubbleClick = true;

      this.body.classList.add("is-dragging");
      bubble.classList.add("is-dragging");

      // Hide caret indicator during drag
      this.hideGapIndicator("caret");

      try {
        e.dataTransfer?.setData("text/plain", String(index));
        e.dataTransfer?.setData(
          "application/x-banyan-bubble-index",
          String(index),
        );
        e.dataTransfer!.effectAllowed = "move";
      } catch {
        // ignore
      }
    });

    bubble.addEventListener("dragend", () => {
      this.clearDragState();
    });

    bubble.addEventListener("dragover", (e: DragEvent) => {
      const draggedItemIDs = this.getDraggedItemIDs(e.dataTransfer);
      if (this.draggingBubbleIndex == null && !draggedItemIDs.length) {
        return;
      }

      // Must preventDefault to allow dropping.
      e.preventDefault();
      e.stopPropagation();

      const index = Number.parseInt(bubble.dataset.bubbleIndex ?? "-1", 10);
      if (index < 0) return;

      const rect = bubble.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      this.dragOverBubbleIndex = index;
      this.dragOverInsertAfter = (e.clientX ?? 0) > midX;

      this.showDropIndicatorFor(index, this.dragOverInsertAfter);

      try {
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect =
            this.draggingBubbleIndex == null ? "copy" : "move";
        }
      } catch {
        // ignore
      }
    });

    bubble.addEventListener("drop", (e: DragEvent) => {
      const draggedItemIDs = this.getDraggedItemIDs(e.dataTransfer);
      if (this.draggingBubbleIndex == null && !draggedItemIDs.length) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      const idx = this.dragOverBubbleIndex;
      if (idx == null) return;

      if (draggedItemIDs.length) {
        const insertIndex = this.dragOverInsertAfter ? idx + 1 : idx;
        this.delegate.onDropItemIDs?.(draggedItemIDs, insertIndex);
        this.hideGapIndicator("drop");
        return;
      }

      this.handleBubbleDrop(idx, this.dragOverInsertAfter);
      this.clearDragState();
    });

    return bubble;
  }

  private onInputKeydown(input: HTMLInputElement, e: KeyboardEvent): void {
    const selStart = input.selectionStart ?? 0;
    const selEnd = input.selectionEnd ?? 0;
    const isCollapsed = selStart === selEnd;

    if (e.key === "Enter") {
      e.preventDefault();
      if (this.popup?.contains(e.target as Node)) {
        this.closePopup();
      }
      this.delegate.onConfirm?.();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      this.closePopup();
      input.value = "";
      this.updateInputWidth(input);
      this.delegate.onSearch("");
      return;
    }
    if (e.key === "ArrowLeft") {
      if (isCollapsed && selStart === 0) {
        const prev = input.previousElementSibling;
        if (prev && prev.classList.contains("bubble")) {
          e.preventDefault();
          (prev as HTMLElement).focus();
          return;
        }
      }
    }
    if (e.key === "ArrowRight") {
      const endPos = input.value.length;
      if (isCollapsed && selEnd === endPos) {
        const next = input.nextElementSibling;
        if (next && next.classList.contains("bubble")) {
          e.preventDefault();
          (next as HTMLElement).focus();
          return;
        }
      }
    }

    // Treat bubbles like characters:
    // - Backspace at start removes previous bubble
    // - Delete at end removes next bubble
    if (isCollapsed && e.key === "Backspace" && selStart === 0) {
      const prev = input.previousElementSibling;
      if (prev && prev.classList.contains("bubble")) {
        e.preventDefault();
        const idx = this.getBubbleElements().indexOf(prev as HTMLElement);
        if (idx >= 0) {
          this.removeCite(this.cites[idx]);
          this.focusInputAfterBubble(Math.max(-1, idx - 1));
        }
        return;
      }
    }

    if (e.key === "Delete") {
      const endPos = input.value.length;
      if (isCollapsed && selEnd === endPos) {
        const next = input.nextElementSibling;
        if (next && next.classList.contains("bubble")) {
          e.preventDefault();
          const idx = this.getBubbleElements().indexOf(next as HTMLElement);
          if (idx >= 0) {
            this.removeCite(this.cites[idx]);
            this.focusInputAfterBubble(Math.max(-1, idx - 1));
          }
        }
      }
    }
  }

  private onBubbleKeydown(
    bubbleEl: HTMLElement,
    cite: Cite,
    e: KeyboardEvent,
  ): void {
    const index = this.getBubbleElements().indexOf(bubbleEl);
    if (index < 0) return;

    // Shift + Arrow: reorder bubbles
    if (e.shiftKey) {
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        this.moveCite(index, index - 1);
        return;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        this.moveCite(index, index + 1);
        return;
      }
    }

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      const prev = bubbleEl.previousElementSibling;
      if (prev && this.isInput(prev)) {
        (prev as HTMLInputElement).focus();
      }
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const next = bubbleEl.nextElementSibling;
      if (next && this.isInput(next)) {
        (next as HTMLInputElement).focus();
      }
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      this.removeCite(cite);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      this.closePopup();
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      this.showPopup(cite, bubbleEl);
      return;
    }
  }

  private showPopup(cite: Cite, anchor: HTMLElement) {
    this.closePopup();
    this.popupAnchor = anchor;
    this.popupCite = cite;

    const popup = document.createElement("div");
    popup.classList.add("bubble-popup");

    // Header
    const header = document.createElement("div");
    header.classList.add("bubble-popup-header");
    header.textContent = cite.item.title || "Untitled";
    popup.appendChild(header);

    // Dynamic controls
    const content = document.createElement("div");
    content.classList.add("bubble-popup-content");

    const resolved = this.resolveCite(cite);
    for (const control of this.citeControls) {
      const state = this.controlState(resolved, control);

      if (control.kind === "list") {
        const editor = this.createListEditor(control, cite, state);
        this.popupListEditors.push(editor);
        content.appendChild(editor.element);
        continue;
      }

      const current = cite.params?.[control.id];
      const handle = createParameterField({
        control,
        value: initialParameterValue(control, current),
        state,
        mode: "xul",
        createXULElementCompat,
        onChange: (value) => {
          this.updateCiteParam(cite, control.id, value as ParamValue);
        },
      });
      this.popupFields.push({ control, handle });
      content.appendChild(handle.element);
    }

    if (content.childElementCount === 0) {
      const empty = document.createElement("div");
      empty.classList.add("bubble-popup-empty");
      empty.textContent = t("citation-dialog-no-cite-params");
      content.appendChild(empty);
    }

    popup.appendChild(content);

    // Actions
    const actions = document.createElement("div");
    actions.classList.add("bubble-popup-actions");

    const removeBtn = document.createElement("button");
    removeBtn.textContent = t("citation-dialog-bubble-remove");
    removeBtn.addEventListener("click", () => {
      this.removeCite(cite);
      this.closePopup();
    });
    actions.appendChild(removeBtn);

    const confirmBtn = document.createElement("button");
    confirmBtn.textContent = t("citation-dialog-bubble-done");
    confirmBtn.addEventListener("click", () => {
      this.closePopup();
    });
    actions.appendChild(confirmBtn);

    popup.appendChild(actions);

    if (document.body) {
      document.body.appendChild(popup);
      this.popup = popup;
    }

    // Positioning: keep the adaptive-width popup inside the dialog viewport.
    const rect = anchor.getBoundingClientRect();
    popup.style.top = `${rect.bottom + 5}px`;
    popup.style.left = `${rect.left}px`;
    const popupRect = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(
      8,
      Math.min(rect.left, window.innerWidth - popupRect.width - 8),
    )}px`;
    popup.style.top = `${Math.max(
      8,
      Math.min(rect.bottom + 5, window.innerHeight - popupRect.height - 8),
    )}px`;

    // Prevent popup click from closing it
    popup.addEventListener("click", (e) => e.stopPropagation());
  }

  private predicateArgs(
    cite: Cite,
  ): [CitationContext, Readonly<StyleOptionValues>] {
    const { citation, options } = this.getPredicateArgs(cite);
    return [citation, options];
  }

  private getPredicateArgs(_cite: Cite): {
    citation: CitationContext;
    options: Readonly<StyleOptionValues>;
  } {
    const citation = {
      id: "citation-dialog",
      page: 0,
      cites: this.cites,
      params: this.context.getCitationParams?.() ?? {},
    } as CitationContext;
    return {
      citation,
      options: this.context.getStyleOptions?.() ?? {},
    };
  }

  private createListEditor(
    control: Extract<CiteParam, { kind: "list" }>,
    cite: Cite,
    initialState: ParamState,
  ): PopupListEditor {
    const container = document.createElement("div");
    container.id = `opt-${control.id}`;
    container.classList.add("bubble-list-editor");

    let state = initialState;
    let rows = listRowsFromState(control, state);
    const fields: PopupListField[] = [];
    const removeButtons: HTMLButtonElement[] = [];
    const addButtons: HTMLButtonElement[] = [];

    const commit = () => {
      if (state.mode !== "free") return;
      this.commitList(cite, control, rows);
      this.schedulePopupRefresh(cite);
    };

    const createActionButton = (
      className: string,
      label: string,
      onClick: () => void,
    ): HTMLButtonElement => {
      const button = document.createElement("button");
      button.type = "button";
      button.classList.add(className);
      button.title = label;
      button.setAttribute("aria-label", label);
      button.addEventListener("click", onClick);
      return button;
    };

    const createRemoveButton = (rowIndex: number): HTMLButtonElement =>
      createActionButton(
        "bubble-list-remove",
        t("citation-dialog-list-remove"),
        () => {
          if (state.mode !== "free" || rows.length <= (control.min ?? 0)) {
            return;
          }
          rows.splice(rowIndex, 1);
          render();
          commit();
        },
      );

    const createAddButton = (rowIndex: number): HTMLButtonElement =>
      createActionButton(
        "bubble-list-add",
        t("citation-dialog-list-add"),
        () => {
          if (state.mode !== "free") return;
          const row: Record<string, string> = {};
          for (const field of control.fields) {
            row[field.id] = String(field.defaultValue ?? "");
          }
          rows.splice(rowIndex + 1, 0, row);
          render();
          commit();
          const nextRow = container.querySelectorAll(".bubble-list-row")[
            rowIndex + 1
          ] as HTMLElement | undefined;
          nextRow?.querySelector<HTMLElement>("input, button")?.focus();
        },
      );

    const render = (validation?: ParamState["fieldValidation"]) => {
      container.replaceChildren();
      fields.length = 0;
      removeButtons.length = 0;
      addButtons.length = 0;

      rows.forEach((row, rowIndex) => {
        const rowEl = document.createElement("div");
        rowEl.classList.add("bubble-list-row");
        const fieldsWrap = document.createElement("div");
        fieldsWrap.classList.add("bubble-list-fields");

        for (const field of control.fields) {
          const fieldWrap = document.createElement("div");
          fieldWrap.classList.add("bubble-list-field");
          const inlineLabel = document.createElement("label");
          inlineLabel.classList.add("bubble-list-inline-label");
          inlineLabel.textContent = field.label;
          let fieldError = "";
          let controlEl: HTMLElement | null = null;
          const setError = (text: string) => {
            fieldError = text;
            if (!controlEl) return;
            if (text) {
              controlEl.setAttribute("aria-invalid", "true");
            } else {
              controlEl.removeAttribute("aria-invalid");
            }
          };
          const announce = () => {
            if (!fieldError) return;
            showValidationError(fieldError);
            const id = controlEl?.id;
            const target = id
              ? (document.getElementById(id) as HTMLElement | null)
              : controlEl;
            target?.focus();
          };

          if (field.format === "rich") {
            const rich = document.createElement("div");
            rich.classList.add("bubble-list-rich");
            const preview = document.createElement("div");
            preview.id = `banyan-list-${control.id}-${rowIndex}-${field.id}`;
            preview.dataset.banyanRowIndex = String(rowIndex);
            preview.dataset.banyanFieldId = field.id;
            preview.classList.add("bubble-list-rich-preview");
            preview.tabIndex = 0;
            preview.setAttribute("role", "button");
            preview.setAttribute("aria-label", t("citation-dialog-edit-rich"));
            preview.title = field.label;
            inlineLabel.htmlFor = preview.id;
            controlEl = preview;

            const renderPreview = () => {
              const richText = richTextFromMarkup(
                String(row[field.id] ?? field.defaultValue ?? ""),
              );
              preview.replaceChildren();
              if (!richText.text) {
                preview.classList.add("is-empty");
                preview.dataset.placeholder = t("citation-dialog-rich-empty");
                return;
              }
              preview.classList.remove("is-empty");
              delete preview.dataset.placeholder;
              preview.appendChild(renderRichTextToFragment(richText));
            };
            const openEditor = () => {
              if (state.mode !== "free") return;
              openRichTextDialog({
                value: String(row[field.id] ?? field.defaultValue ?? ""),
                title: field.label,
                onCommit: (markup) => {
                  row[field.id] = markup;
                  renderPreview();
                  commit();
                  queueMicrotask(announce);
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
            fieldWrap.append(inlineLabel, rich);
            renderPreview();
          } else {
            const input = document.createElement("input");
            input.type = "text";
            input.id = `banyan-list-${control.id}-${rowIndex}-${field.id}`;
            input.dataset.banyanRowIndex = String(rowIndex);
            input.dataset.banyanFieldId = field.id;
            input.value = String(row[field.id] ?? field.defaultValue ?? "");
            input.autocomplete = "off";
            input.placeholder = field.label;
            input.title = field.label;
            input.setAttribute("aria-label", field.label);
            inlineLabel.htmlFor = input.id;
            controlEl = input;
            if (field.presets?.length) {
              const listID = `banyan-list-${control.id}-${rowIndex}-${field.id}`;
              const datalist = document.createElement("datalist");
              datalist.id = listID;
              for (const preset of field.presets) {
                const option = document.createElement("option");
                option.value =
                  typeof preset === "string" ? preset : preset.value;
                option.label =
                  typeof preset === "string" ? preset : preset.label;
                datalist.appendChild(option);
              }
              input.setAttribute("list", listID);
              fieldWrap.appendChild(datalist);
            }
            const update = () => {
              if (state.mode !== "free") return;
              row[field.id] = input.value;
              commit();
            };
            input.addEventListener("input", update);
            input.addEventListener("change", update);
            input.addEventListener("blur", () => queueMicrotask(announce));
            fieldWrap.append(inlineLabel, input);
          }

          fields.push({
            field,
            row,
            rowIndex,
            getValue: () => row[field.id] ?? field.defaultValue ?? "",
            getError: () => fieldError,
            setError,
          });
          fieldsWrap.appendChild(fieldWrap);
        }

        const actions = document.createElement("div");
        actions.classList.add("bubble-list-actions");
        const remove = createRemoveButton(rowIndex);
        removeButtons.push(remove);
        const add = createAddButton(rowIndex);
        addButtons.push(add);
        actions.append(remove, add);
        rowEl.append(fieldsWrap, actions);
        container.appendChild(rowEl);
      });

      if (rows.length === 0) {
        const actions = document.createElement("div");
        actions.classList.add("bubble-list-actions");
        const add = createAddButton(-1);
        addButtons.push(add);
        actions.appendChild(add);
        container.appendChild(actions);
      }
      applyDisabled(validation);
    };

    const applyDisabled = (fieldValidation?: ParamState["fieldValidation"]) => {
      const disabled = state.mode !== "free";
      container.hidden = state.mode === "hidden";
      container.classList.toggle("is-disabled", disabled);
      const listInputs = container.querySelectorAll("input, select, textarea");
      for (let index = 0; index < listInputs.length; index++) {
        const el = listInputs.item(index);
        if (el) setElementDisabled(el, disabled);
      }
      for (const node of container.querySelectorAll(
        ".bubble-list-rich-preview",
      )) {
        const preview = node as HTMLElement;
        preview.tabIndex = disabled ? -1 : 0;
        preview.setAttribute("aria-disabled", String(disabled));
      }
      for (const button of removeButtons) {
        button.disabled = disabled || rows.length <= (control.min ?? 0);
      }
      for (const button of addButtons) {
        button.disabled =
          disabled || rows.length >= (control.max ?? Number.POSITIVE_INFINITY);
      }

      const validation =
        fieldValidation ??
        (disabled
          ? undefined
          : this.controlState(this.resolveCite(cite), control).fieldValidation);
      for (const entry of fields) {
        if (disabled) {
          entry.setError("");
          continue;
        }
        const result = validation?.[entry.field.id]?.[entry.rowIndex];
        entry.setError(
          result && !result.valid && result.source !== "default"
            ? result.message || t("citation-dialog-invalid-input")
            : "",
        );
      }
    };

    const refresh = (
      next: ParamState,
      fieldValidation?: ParamState["fieldValidation"],
    ) => {
      const nextRows = listRowsFromState(control, next);
      const changed =
        next.mode !== state.mode ||
        next.mode !== "free" ||
        !sameRows(rows, nextRows);
      state = next;
      if (changed) {
        const focus = captureListCellFocus(container);
        rows = nextRows;
        render(fieldValidation);
        restoreListCellFocus(container, focus);
      } else {
        applyDisabled(fieldValidation);
      }
    };

    render(initialState.fieldValidation);
    return { control, element: container, refresh };
  }

  private resolveCite(cite: Cite): ResolvedCite {
    const { citation, options } = this.getPredicateArgs(cite);
    return resolveCiteParamValues(this.citeControls, cite, citation, options);
  }

  private controlState(resolved: ResolvedCite, control: CiteParam): ParamState {
    return (
      resolved.states[control.id] ?? {
        mode: "free",
        value: resolved.effectiveValues[control.id] ?? "",
      }
    );
  }

  private getEffectiveListRows(
    resolved: ResolvedCite,
    control: Extract<CiteParam, { kind: "list" }>,
  ): ListRow[] {
    return listRowsFromState(control, this.controlState(resolved, control));
  }

  private commitList(
    cite: Cite,
    control: Extract<CiteParam, { kind: "list" }>,
    rows: ListRow[],
  ): void {
    if (!cite.params) cite.params = {};
    cite.params[control.id] = rows;
    this.delegate.onCitesChanged(this.cites);
  }

  private closePopup() {
    if (this.popup) {
      this.popup.remove();
      this.popup = null;
    }
    this.popupAnchor = null;
    this.popupCite = null;
    this.popupFields = [];
    this.popupListEditors = [];
    this.popupRefreshPending = false;
  }

  private updateCiteParam(cite: Cite, key: string, value: ParamValue) {
    if (!cite.params) cite.params = {};
    cite.params[key] = value;
    this.delegate.onCitesChanged(this.cites);
    this.schedulePopupRefresh(cite);
  }

  /** Coalesce one burst of input into a single state recalculation. */
  private schedulePopupRefresh(cite: Cite): void {
    if (this.popupCite !== cite || this.popupRefreshPending) return;
    this.popupRefreshPending = true;
    queueMicrotask(() => {
      this.popupRefreshPending = false;
      if (this.popupCite === cite) {
        this.refreshPopupState(cite);
      }
    });
  }

  private refreshPopupState(cite: Cite): void {
    if (this.popupCite !== cite) return;
    const resolved = this.resolveCite(cite);
    for (const { control, handle } of this.popupFields) {
      handle.refresh(this.controlState(resolved, control));
    }
    for (const editor of this.popupListEditors) {
      const state = this.controlState(resolved, editor.control);
      editor.refresh(state, state.fieldValidation);
    }
  }
}
