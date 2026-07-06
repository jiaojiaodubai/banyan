import type { RichText } from "../../typings/unit";
import {
  getRichTextSegments,
  richTextFromRuns,
  RichTextRun,
  RichTextSegment,
} from "../utils/richText";
import { sanitizeLink } from "../utils/html";
import { useL10n } from "../utils/locale";

type UnitStyle = Omit<RichTextRun, "value">;
type UnitLinkHandler = (link: string, event: Event) => boolean | void;
type RenderRichTextOptions = {
  onLinkClick?: UnitLinkHandler;
};

const NAV_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

type ToolbarCommand =
  "bold" | "italic" | "superscript" | "subscript" | "removeFormat";

export class RichTextEditor {
  private readonly editorEl: HTMLDivElement;
  private readonly toolbarEl: HTMLDivElement;
  private readonly buttons: Map<ToolbarCommand, HTMLButtonElement> = new Map();
  constructor(el: HTMLDivElement) {
    el.classList.add("banyan-richtext");

    this.toolbarEl = this.createToolbar();
    this.editorEl = this.createEditor();
    el.append(this.toolbarEl, this.editorEl);
    this.initToolbar();
    this.patchNavKey();
    this.bindEvent();
  }

  private createToolbar(): HTMLDivElement {
    const toolbar = document.createElement("div") as HTMLDivElement;
    toolbar.classList.add("banyan-richtext-toolbar");
    return toolbar;
  }

  private createEditor(): HTMLDivElement {
    const editor = document.createElement("div") as HTMLDivElement;
    editor.contentEditable = "true";
    editor.spellcheck = false;
    editor.classList.add("banyan-richtext-editor");
    if (!editor.hasAttribute("tabindex")) {
      editor.setAttribute("tabindex", "0");
    }
    return editor;
  }

  private initToolbar(): void {
    const t = useL10n(["richTextEditor.ftl"]);
    this.createTbButton(
      "bold",
      `${t("richtext-editor-format-bold")} (Ctrl+B)`,
      "banyan-icon-bold",
    );
    this.createTbButton(
      "italic",
      `${t("richtext-editor-format-italic")} (Ctrl+I)`,
      "banyan-icon-italic",
    );
    this.createTbButton(
      "superscript",
      `${t("richtext-editor-format-superscript")} (Ctrl+Shift+=)`,
      "banyan-icon-superscript",
    );
    this.createTbButton(
      "subscript",
      `${t("richtext-editor-format-subscript")} (Ctrl+=)`,
      "banyan-icon-subscript",
    );
    this.createTbButton(
      "removeFormat",
      t("richtext-editor-format-clear"),
      "banyan-icon-remove-format",
    );
  }

  private createTbButton(
    command: ToolbarCommand,
    tooltip: string,
    iocnName: string,
  ): Element {
    const button = document.createElement("button") as HTMLButtonElement;
    button.classList.add("banyan-toolbar-button", iocnName);
    button.setAttribute("title", tooltip);
    this.buttons.set(command, button);
    this.toolbarEl.appendChild(button);
    return button;
  }

  // Annomyous function to keep "this" context
  private updateState = (): void => {
    for (const [command, button] of this.buttons) {
      if (command === "removeFormat") {
        continue;
      }
      button.classList.toggle("active", document.queryCommandState(command));
    }
  };

  setRichText(richText: RichText): void {
    this.editorEl.textContent = "";
    this.editorEl.appendChild(renderRichTextToFragment(richText));
  }

  getRichText(): RichText {
    return richTextFromEditor(this.editorEl);
  }

  private patchNavKey(): void {
    const onNavKeydown = (event: KeyboardEvent) => {
      if (!NAV_KEYS.has(event.key)) return;
      const selection = window.getSelection();
      if (!selection || typeof selection.modify !== "function") return;
      event.preventDefault();
      event.stopPropagation();
      // event.stopImmediatePropagation();
      const alter = event.shiftKey ? "extend" : "move";
      switch (event.key) {
        case "ArrowLeft":
          selection.modify(alter, "backward", "character");
          break;
        case "ArrowRight":
          selection.modify(alter, "forward", "character");
          break;
        case "ArrowUp":
          selection.modify(alter, "backward", "line");
          break;
        case "ArrowDown":
          selection.modify(alter, "forward", "line");
          break;
        case "Home":
          selection.modify(alter, "backward", "lineboundary");
          break;
        case "End":
          selection.modify(alter, "forward", "lineboundary");
          break;
        case "PageUp":
          selection.modify(alter, "backward", "page");
          break;
        case "PageDown":
          selection.modify(alter, "forward", "page");
          break;
        default:
          break;
      }
    };
    this.editorEl.addEventListener("keydown", onNavKeydown);
  }

  private bindEvent(): void {
    for (const [command, button] of this.buttons) {
      button.addEventListener("click", () => {
        // Deprecated but still a convenient way to implement rich text editing in Firefox ESR 140
        // https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand
        document.execCommand(command, false);
        this.updateState();
      });
    }
    this.editorEl.addEventListener("keydown", (event: KeyboardEvent) => {
      if (!event.ctrlKey) return;
      if (event.altKey || event.metaKey) return;
      if (event.key === "b" || event.key === "B") {
        event.preventDefault();
        document.execCommand("bold", false);
        this.updateState();
        return;
      }
      if (event.key === "i" || event.key === "I") {
        event.preventDefault();
        document.execCommand("italic", false);
        this.updateState();
        return;
      }
      if (event.key === "=" && event.shiftKey) {
        event.preventDefault();
        document.execCommand("superscript", false);
        this.updateState();
        return;
      }
      if (event.key === "=" && !event.shiftKey) {
        event.preventDefault();
        document.execCommand("subscript", false);
        this.updateState();
      }
    });
    this.editorEl.addEventListener("keyup", this.updateState, true);
    this.editorEl.addEventListener("mouseup", this.updateState, true);
    this.editorEl.addEventListener("input", this.updateState, true);
    document.addEventListener("selectionchange", this.updateState, true);
  }
}

export function renderRichTextToFragment(
  richText: RichText,
  options: RenderRichTextOptions = {},
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  let currentLink = "";
  let currentAnchor: HTMLAnchorElement | null = null;

  for (const unit of getRichTextSegments(richText)) {
    const node = createNodeFromUnit(unit);
    const link = sanitizeLink(unit.link);
    if (!link) {
      currentLink = "";
      currentAnchor = null;
      fragment.appendChild(node);
      continue;
    }

    if (!currentAnchor || currentLink !== link) {
      currentLink = link;
      currentAnchor = createLinkElement(link, options);
      fragment.appendChild(currentAnchor);
    }
    currentAnchor.appendChild(node);
  }
  return fragment;
}

function createNodeFromUnit(unit: RichTextSegment): Node {
  let current: Node = document.createTextNode(unit.value ?? "");

  if (unit.bold) {
    const strong = document.createElement("strong");
    strong.appendChild(current);
    current = strong;
  }
  if (unit.italic) {
    const em = document.createElement("em");
    em.appendChild(current);
    current = em;
  }
  if (unit.script === "superscript") {
    const sup = document.createElement("sup");
    sup.appendChild(current);
    current = sup;
  } else if (unit.script === "subscript") {
    const sub = document.createElement("sub");
    sub.appendChild(current);
    current = sub;
  }

  if (unit.color || unit.backgroundColor) {
    const span = document.createElement("span");
    if (unit.color) span.style.color = unit.color;
    if (unit.backgroundColor) span.style.backgroundColor = unit.backgroundColor;
    span.appendChild(current);
    current = span;
  }

  return current;
}

function createLinkElement(
  link: string,
  options: RenderRichTextOptions,
): HTMLAnchorElement {
  const a = document.createElement("a");
  a.href = link;
  a.target = "_blank";
  a.rel = "noreferrer";
  a.addEventListener("click", (event) => {
    event.preventDefault();
    const handled = options.onLinkClick?.(link, event);
    if (handled !== true) {
      Zotero.launchURL(link);
    }
  });
  return a;
}

function richTextFromEditor(editor: HTMLElement): RichText {
  const units: RichTextRun[] = [];

  const sameStyle = (a: RichTextRun, b: UnitStyle): boolean => {
    return (
      a.bold === b.bold &&
      a.italic === b.italic &&
      a.script === b.script &&
      a.link === b.link &&
      a.color === b.color &&
      a.backgroundColor === b.backgroundColor
    );
  };

  const pushUnit = (value: string, style: UnitStyle): void => {
    if (!value) return;
    const last = units[units.length - 1];
    if (last && sameStyle(last, style)) {
      last.value += value;
      return;
    }
    units.push({ value, ...style });
  };

  const pushNewline = (style: UnitStyle): void => {
    if (units.length === 0) return;
    const last = units[units.length - 1];
    if (last.value.endsWith("\n")) return;
    pushUnit("\n", style);
  };

  const walk = (node: Node | null, style: UnitStyle): void => {
    if (!node) return;

    if (node.nodeType === Node.TEXT_NODE) {
      pushUnit(node.textContent ?? "", style);
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const nextStyle: UnitStyle = { ...style };

    if (tag === "strong" || tag === "b") nextStyle.bold = true;
    if (tag === "em" || tag === "i") nextStyle.italic = true;
    if (tag === "sup") nextStyle.script = "superscript";
    if (tag === "sub") nextStyle.script = "subscript";
    if (tag === "a") {
      const href = el.getAttribute("href");
      const link = sanitizeLink(href);
      if (link) nextStyle.link = link;
    }

    if (tag === "br") {
      pushNewline(style);
      return;
    }

    const isBlock = tag === "div" || tag === "p";
    const children = Array.from(el.childNodes);
    for (const child of children) {
      walk(child, nextStyle);
    }
    if (isBlock) {
      pushNewline(style);
    }
  };

  if (editor.childNodes.length > 0) {
    for (const child of Array.from(editor.childNodes)) {
      walk(child, {});
    }
  } else if (editor instanceof HTMLTextAreaElement) {
    pushUnit(editor.value ?? "", {});
  }

  return richTextFromRuns(units);
}
