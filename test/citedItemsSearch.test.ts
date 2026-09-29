import { assert } from "chai";
import {
  buildDocumentCitationPreviewMap,
  getCitationPreviewText,
  getCitedItemsSearchLabel,
  mergeDocumentCitationPreviews,
} from "../src/utils/citedItemsSearch";
import type {
  CitationContext,
  IntextCitation,
  NoteCitation,
} from "../typings/style";

function createContext(id: string, itemIDs: Array<number | undefined>) {
  return {
    id,
    page: 1,
    params: {},
    cites: itemIDs.map((itemID) => ({ item: { id: itemID } })),
  } as unknown as CitationContext;
}

function createCitation(text: string) {
  return {
    id: "ctx-1",
    type: "intext-citation",
    content: { text, marks: [] },
  } as unknown as IntextCitation;
}

function buildPreviews(
  contexts: CitationContext[],
  citations: Array<IntextCitation | NoteCitation>,
) {
  return buildDocumentCitationPreviewMap(contexts, citations, (citation) => {
    // `renderRichTextToHtml()` returns nothing for content with no text.
    const text = citation.content.text.trim();
    return text ? `<sup>${text}</sup>` : "";
  });
}

describe("citation collection helpers", function () {
  it("trims full-path document ids to extensionless file names", function () {
    assert.equal(
      getCitedItemsSearchLabel("C:\\Users\\me\\Documents\\My Draft.docx"),
      "My Draft",
    );
    assert.equal(
      getCitedItemsSearchLabel("/Users/me/Documents/Chapter 01.odt"),
      "Chapter 01",
    );
    assert.equal(
      getCitedItemsSearchLabel("\\\\server\\share\\My Draft.docx"),
      "My Draft",
    );
    assert.equal(getCitedItemsSearchLabel("word-session-1"), "word-session-1");
    assert.equal(getCitedItemsSearchLabel("Draft.docx"), "Draft.docx");
    assert.equal(getCitedItemsSearchLabel("   "), "Untitled");
  });

  it("builds ordered per-item citation previews from refresh data", function () {
    const contexts = [
      createContext("ctx-1", [101, 102]),
      createContext("ctx-2", [101]),
    ];
    const citations = [
      createCitation("(Smith, 2024)"),
      createCitation("(Smith, 2024, p. 10)"),
    ];

    const previews = buildPreviews(contexts, citations);

    assert.deepEqual(Array.from(previews.keys()), [101, 102]);
    assert.deepEqual(previews.get(101), {
      htmlParts: [
        "<sup>(Smith, 2024)</sup>",
        "<sup>(Smith, 2024, p. 10)</sup>",
      ],
      textParts: ["(Smith, 2024)", "(Smith, 2024, p. 10)"],
    });
    assert.deepEqual(previews.get(102), {
      htmlParts: ["<sup>(Smith, 2024)</sup>"],
      textParts: ["(Smith, 2024)"],
    });
    assert.equal(
      getCitationPreviewText(previews.get(101)!),
      "(Smith, 2024)  (Smith, 2024, p. 10)",
    );
  });

  it("keeps a repeat out of a preview but leaves a later one in", function () {
    const contexts = [
      createContext("ctx-1", [101]),
      createContext("ctx-2", [101]),
      createContext("ctx-3", [101]),
    ];
    const citations = [
      createCitation("(Smith, 2024)"),
      createCitation("(Smith, 2024)"),
      createCitation("(Smith, 2025)"),
    ];

    assert.deepEqual(buildPreviews(contexts, citations).get(101)?.textParts, [
      "(Smith, 2024)",
      "(Smith, 2025)",
    ]);
  });

  it("skips citations with no text and cites with no item id", function () {
    const contexts = [
      createContext("ctx-1", [undefined, 101]),
      createContext("ctx-2", [102]),
    ];
    const citations = [createCitation("   "), createCitation("(Jones, 2025)")];

    const previews = buildPreviews(contexts, citations);

    assert.deepEqual(Array.from(previews.keys()), [102]);
    assert.deepEqual(previews.get(102), {
      htmlParts: ["<sup>(Jones, 2025)</sup>"],
      textParts: ["(Jones, 2025)"],
    });
  });

  it("pairs contexts with citations up to the shorter list", function () {
    const contexts = [
      createContext("ctx-1", [101]),
      createContext("ctx-2", [102]),
    ];

    const previews = buildPreviews(contexts, [createCitation("(Smith, 2024)")]);

    assert.deepEqual(Array.from(previews.keys()), [101]);
  });

  it("merges one item's previews across documents, dropping repeats", function () {
    const merged = mergeDocumentCitationPreviews([
      {
        htmlParts: ["<sup>(Smith, 2024)</sup>"],
        textParts: ["(Smith, 2024)"],
      },
      {
        htmlParts: [
          "<sup>(Smith, 2024)</sup>",
          "<sup>(Smith, 2024, p. 10)</sup>",
        ],
        textParts: ["(Smith, 2024)", "(Smith, 2024, p. 10)"],
      },
    ]);

    assert.deepEqual(merged, {
      htmlParts: [
        "<sup>(Smith, 2024)</sup>",
        "<sup>(Smith, 2024, p. 10)</sup>",
      ],
      textParts: ["(Smith, 2024)", "(Smith, 2024, p. 10)"],
    });
    assert.deepEqual(mergeDocumentCitationPreviews([]), {
      htmlParts: [],
      textParts: [],
    });
  });
});
