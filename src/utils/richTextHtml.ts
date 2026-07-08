import type { BibliographyLine } from "../../typings/style";
import type { RichText } from "../../typings/unit";
import { escapeAttribute, escapeHtml, sanitizeLink } from "./html";
import { getRichTextSegments, type RichTextSegment } from "./richText";

export type RenderRichTextFragmentOptions = {
  onLinkClick?: (link: string, event: MouseEvent) => boolean | void;
};

export type RenderRichTextToHtmlOptions = {
  includeLinks?: boolean;
};

export function renderRichTextToHtml(
  richText: RichText,
  options: RenderRichTextToHtmlOptions = {},
): string {
  if (options.includeLinks === false) {
    return getRichTextSegments(richText)
      .map((unit) => renderUnitVisualToHtml(unit))
      .join("");
  }

  const out: string[] = [];
  let currentLink = "";
  let currentLinkParts: string[] = [];

  const flushLink = () => {
    if (!currentLink) {
      return;
    }
    out.push(
      `<a href="${escapeAttribute(currentLink)}">${currentLinkParts.join("")}</a>`,
    );
    currentLink = "";
    currentLinkParts = [];
  };

  for (const unit of getRichTextSegments(richText)) {
    const html = renderUnitVisualToHtml(unit);
    const link = sanitizeLink(unit.link);
    if (!link) {
      flushLink();
      out.push(html);
      continue;
    }

    if (currentLink && currentLink !== link) {
      flushLink();
    }
    currentLink = link;
    currentLinkParts.push(html);
  }

  flushLink();
  return out.join("");
}

export function renderRichTextToText(richText: RichText): string {
  return richText.text;
}

export function renderRichTextToFragment(
  richText: RichText,
  doc: Document = document,
  options: RenderRichTextFragmentOptions = {},
): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  let currentLink = "";
  let currentAnchor: HTMLAnchorElement | null = null;

  for (const unit of getRichTextSegments(richText)) {
    const node = createNodeFromUnit(doc, unit);
    const link = sanitizeLink(unit.link);
    if (!link) {
      currentLink = "";
      currentAnchor = null;
      fragment.appendChild(node);
      continue;
    }

    if (!currentAnchor || currentLink !== link) {
      currentLink = link;
      currentAnchor = createLinkElement(doc, link, options);
      fragment.appendChild(currentAnchor);
    }
    currentAnchor.appendChild(node);
  }

  return fragment;
}

export function renderBibliographyLineToHtml(line: BibliographyLine): string {
  const inner = renderRichTextToHtml(line.content);
  if (line.type === "bibliography-title") {
    return `<h1>${inner}</h1>`;
  }
  return `<p>${inner}</p>`;
}

function renderUnitVisualToHtml(unit: RichTextSegment): string {
  let text = escapeHtml(unit.value);
  if (unit.bold) text = `<strong>${text}</strong>`;
  if (unit.italic) text = `<em>${text}</em>`;
  if (unit.script === "superscript") text = `<sup>${text}</sup>`;
  if (unit.script === "subscript") text = `<sub>${text}</sub>`;
  const style: string[] = [];
  if (unit.color) style.push(`color:${escapeAttribute(unit.color)}`);
  if (unit.backgroundColor) {
    style.push(`background-color:${escapeAttribute(unit.backgroundColor)}`);
  }
  if (style.length) text = `<span style="${style.join(";")}">${text}</span>`;
  return text;
}

function createNodeFromUnit(doc: Document, unit: RichTextSegment): Node {
  let current: Node = doc.createTextNode(unit.value ?? "");

  if (unit.bold) {
    const strong = doc.createElement("strong");
    strong.appendChild(current);
    current = strong;
  }
  if (unit.italic) {
    const em = doc.createElement("em");
    em.appendChild(current);
    current = em;
  }
  if (unit.script === "superscript") {
    const sup = doc.createElement("sup");
    sup.appendChild(current);
    current = sup;
  } else if (unit.script === "subscript") {
    const sub = doc.createElement("sub");
    sub.appendChild(current);
    current = sub;
  }

  if (unit.color || unit.backgroundColor) {
    const span = doc.createElement("span");
    if (unit.color) span.style.color = unit.color;
    if (unit.backgroundColor) span.style.backgroundColor = unit.backgroundColor;
    span.appendChild(current);
    current = span;
  }

  return current;
}

function createLinkElement(
  doc: Document,
  link: string,
  options: RenderRichTextFragmentOptions,
): HTMLAnchorElement {
  const a = doc.createElement("a");
  a.href = link;
  a.target = "_blank";
  a.rel = "noreferrer";
  a.addEventListener("click", (event: MouseEvent) => {
    event.preventDefault();
    const handled = options.onLinkClick?.(link, event);
    if (handled !== true) {
      Zotero.launchURL(link);
    }
  });
  return a;
}
