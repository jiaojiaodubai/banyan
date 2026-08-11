import type { Cite, CiteStyleComponent } from "../../typings/style";
import type { Item } from "../../typings/item";
import { getItemDisplayLabel } from "../utils/item";
import { useL10n } from "../utils/locale";

type XULCheckboxElement = Element & { checked: boolean };
type XULMenulistElement = Element & { value: string };

const t = useL10n(["citationDialog.ftl"]);

export interface BubbleInputDelegate {
  onSearch: (query: string) => void;
  onCitesChanged: (cites: Cite[]) => void;
  onConfirm?: () => void;
  onDropItemIDs?: (itemIDs: number[], insertIndex: number) => void;
}

export class BubbleInput {
  private container: HTMLElement;
  private delegate: BubbleInputDelegate;
  private cites: Cite[] = [];
  private styleComponents: CiteStyleComponent[];
  private body: HTMLDivElement;
  private lastFocusedInput: HTMLInputElement | null = null;
  private popup: HTMLElement | null = null;
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
    styleComponents: CiteStyleComponent[],
    delegate: BubbleInputDelegate,
  ) {
    this.container = container;
    this.styleComponents = styleComponents;
    this.delegate = delegate;

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
        if (target && this.popup.contains(target)) return;
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
    // Initialize default values
    this.styleComponents.forEach((comp) => {
      if (cite.params![comp.id] === undefined) {
        cite.params![comp.id] = comp.value;
      }
    });

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
    // Don't steal focus from outside consumers (e.g. ItemTree). Only restore focus
    // if focus was already within the bubble input.
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

    // Set placeholder and let the only input expand full-width
    const isOnlyInput = this.cites.length === 0;
    const first = this.body.firstElementChild;
    if (first && this.isInput(first)) {
      first.classList.toggle("full-width", isOnlyInput);
    }

    // Ensure widths
    for (const input of this.getAllInputs()) {
      this.updateInputWidth(input);
    }

    // Keep focus in bubble input only if it previously had focus
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

    const createXULElement = (tag: string): Element => {
      const doc = document as Document & {
        createXULElement?: (tagName: string) => Element;
      };
      if (typeof doc.createXULElement === "function") {
        return doc.createXULElement(tag);
      }
      return document.createElementNS(
        "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        tag,
      );
    };

    const popup = document.createElement("div");
    popup.classList.add("bubble-popup");

    // Header
    const header = document.createElement("div");
    header.classList.add("bubble-popup-header");
    header.textContent = cite.item.title || "Untitled";
    popup.appendChild(header);

    // Dynamic Components
    const content = document.createElement("div");
    content.classList.add("bubble-popup-content");

    this.styleComponents.forEach((comp) => {
      if (comp.disabled) return;
      if (!this.isComponentVisibleForItem(comp, cite.item)) return;

      const row = document.createElement("div");
      row.classList.add("bubble-popup-row");

      let input: Element;
      const currentVal = cite.params?.[comp.id];

      if (comp.type === "input") {
        const label = document.createElement("label");
        label.classList.add("bubble-popup-label");
        label.textContent = comp.label;
        row.appendChild(label);

        const el = document.createElement("input");
        el.type = "text";
        el.classList.add("bubble-popup-control");
        el.value = String(currentVal ?? comp.value ?? "");
        el.addEventListener("input", () => {
          this.updateCiteParam(cite, comp.id, el.value);
        });
        input = el;
      } else if (comp.type === "checkbox") {
        // Keep 2-column grid alignment (matches Zotero itemDetails popup pattern)
        const spacer = document.createElement("div");
        spacer.classList.add("bubble-popup-label");
        row.appendChild(spacer);

        // XUL checkbox carries its own label (Preferences style)
        const el = createXULElement("checkbox") as XULCheckboxElement;
        el.setAttribute("native", "true");
        el.setAttribute("label", comp.label);
        el.classList.add("bubble-popup-control");
        el.checked = Boolean(currentVal ?? comp.value);
        el.addEventListener("command", () => {
          this.updateCiteParam(cite, comp.id, Boolean(el.checked));
        });
        input = el;
      } else if (comp.type === "select") {
        const label = createXULElement("label");
        label.setAttribute("value", comp.label);
        label.classList.add("bubble-popup-label");
        row.appendChild(label);

        const el = createXULElement("menulist") as XULMenulistElement;
        el.setAttribute("native", "true");
        el.classList.add("bubble-popup-control");

        const menupopup = createXULElement("menupopup");
        Object.entries(comp.options).forEach(([value, label]) => {
          const menuitem = createXULElement("menuitem");
          menuitem.setAttribute("value", value);
          menuitem.setAttribute("label", label);
          menupopup.appendChild(menuitem);
        });
        el.appendChild(menupopup);

        const initial = String(currentVal ?? comp.value ?? "");
        el.value = initial;
        el.setAttribute("value", initial);

        el.addEventListener("command", () => {
          this.updateCiteParam(cite, comp.id, String(el.value ?? ""));
        });
        input = el;
      } else {
        input = document.createElement("span");
      }

      row.appendChild(input);
      content.appendChild(row);
    });

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

    // Positioning
    const rect = anchor.getBoundingClientRect();
    popup.style.top = `${rect.bottom + 5}px`;
    popup.style.left = `${rect.left}px`;

    // Prevent popup click from closing it
    popup.addEventListener("click", (e) => e.stopPropagation());
  }

  private isComponentVisibleForItem(
    component: CiteStyleComponent,
    item: Item,
  ): boolean {
    const allowedTypes = component.itemType;
    if (allowedTypes?.length && !allowedTypes.includes(item.itemType)) {
      return false;
    }

    const allowedCslTypes = component.cslType;
    if (!allowedCslTypes?.length) {
      return true;
    }

    const itemCslTypes = this.getItemCslTypes(item);
    if (!itemCslTypes.length) {
      return false;
    }
    return allowedCslTypes.some((type) => itemCslTypes.includes(type));
  }

  private getItemCslTypes(item: Item): string[] {
    const raw = item.extra?.type;
    if (typeof raw === "string") {
      const value = raw.trim().toLowerCase();
      return value ? [value] : [""];
    }
    if (Array.isArray(raw)) {
      const normalized = raw
        .map((value) =>
          String(value ?? "")
            .trim()
            .toLowerCase(),
        )
        .filter((value, index, array) => array.indexOf(value) === index);
      return normalized.length ? normalized : [""];
    }
    return [""];
  }

  private closePopup() {
    if (this.popup) {
      this.popup.remove();
      this.popup = null;
    }
  }

  private updateCiteParam(cite: Cite, key: string, value: string | boolean) {
    if (!cite.params) cite.params = {};
    cite.params[key] = value;
    this.delegate.onCitesChanged(this.cites);
  }
}
