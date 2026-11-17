/**
 * DOM rendering of compiled rich text for plugin UI (previews, dialogs).
 *
 * The core owns the string rendering of style output; this layer adds real DOM
 * nodes and host link handling, so it stays on the host side of the boundary.
 */
import type { RichText } from "@banyan/core/types/unit";
import { sanitizeLink } from "@banyan/core/richText/html";
import {
  getRichTextSegments,
  type RichTextSegment,
} from "@banyan/core/richText/richText";

export type RenderRichTextFragmentOptions = {
  onLinkClick?: (link: string, event: MouseEvent) => boolean | void;
};

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
