import type {
  CitationContext,
  IntextCitation,
  NoteCitation,
} from "../../typings/style";

export type DocumentCitationPreview = {
  /** One entry per citation, in document order, without repeats of the previous one. */
  htmlParts: string[];
  /** Plain text of those citations, in the same order. */
  textParts: string[];
};

type CitationOutput = IntextCitation | NoteCitation;

export function getCitedItemsSearchLabel(documentId: string): string {
  const trimmed = documentId.trim();
  if (!trimmed) {
    return "Untitled";
  }

  if (!isFullPathDocumentId(trimmed)) {
    return trimmed;
  }

  const segments = trimmed.split(/[\\/]+/).filter(Boolean);
  const fileName = segments.at(-1) ?? trimmed;
  const withoutExtension = fileName.replace(/\.[^./\\]+$/, "").trim();
  return withoutExtension || fileName || trimmed;
}

export function isFullPathDocumentId(documentId: string): boolean {
  return (
    /^[a-z]:[\\/]/i.test(documentId) ||
    /^\\\\[^\\/]+[\\/][^\\/]+/.test(documentId) ||
    /^\//.test(documentId)
  );
}

export function buildDocumentCitationPreviewMap(
  contexts: CitationContext[],
  citations: CitationOutput[],
  renderToHtml: (citation: CitationOutput) => string,
): Map<number, DocumentCitationPreview> {
  const previewParts = new Map<number, { html: string[]; text: string[] }>();
  const count = Math.min(contexts.length, citations.length);

  for (let index = 0; index < count; index += 1) {
    const context = contexts[index];
    const citation = citations[index];
    const html = renderToHtml(citation).trim();
    const text = citation.content.text.trim();
    if (!html && !text) {
      continue;
    }

    const itemIDs = new Set(
      context.cites
        .map((cite) => cite.item.id)
        .filter((itemId): itemId is number => typeof itemId === "number"),
    );

    for (const itemId of itemIDs) {
      let bucket = previewParts.get(itemId);
      if (!bucket) {
        bucket = { html: [], text: [] };
        previewParts.set(itemId, bucket);
      }

      pushUniquePart(bucket.html, html);
      pushUniquePart(bucket.text, text);
    }
  }

  return new Map(
    Array.from(previewParts.entries()).map(([itemId, parts]) => [
      itemId,
      {
        htmlParts: parts.html,
        textParts: parts.text,
      },
    ]),
  );
}

/** The preview joined the way a cell or a tooltip shows it. */
export function getCitationPreviewText(
  preview: DocumentCitationPreview,
): string {
  return preview.textParts.join("  ");
}

/**
 * Combine what several documents say about one item, in order and without an
 * adjacent repeat.
 */
export function mergeDocumentCitationPreviews(
  previews: DocumentCitationPreview[],
): DocumentCitationPreview {
  const htmlParts: string[] = [];
  const textParts: string[] = [];

  for (const preview of previews) {
    for (const html of preview.htmlParts) {
      pushUniquePart(htmlParts, html);
    }
    for (const text of preview.textParts) {
      pushUniquePart(textParts, text);
    }
  }

  return { htmlParts, textParts };
}

function pushUniquePart(parts: string[], part: string): void {
  if (part && parts.at(-1) !== part) {
    parts.push(part);
  }
}
