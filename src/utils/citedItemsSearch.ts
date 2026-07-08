import type {
  CitationContext,
  IntextCitation,
  NoteCitation,
} from "../../typings/style";

export const CITED_ITEMS_SEARCH_MARKER =
  "__banyan_cited_items_search_collection__";

export type DocumentCitationPreview = {
  htmlParts: string[];
  text: string;
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

      if (html && bucket.html.at(-1) !== html) {
        bucket.html.push(html);
      }
      if (text && bucket.text.at(-1) !== text) {
        bucket.text.push(text);
      }
    }
  }

  return new Map(
    Array.from(previewParts.entries()).map(([itemId, parts]) => [
      itemId,
      {
        htmlParts: parts.html,
        text: parts.text.join("  "),
      },
    ]),
  );
}
