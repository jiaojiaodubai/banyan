import { assert } from "chai";
import {
  buildDocumentCitationPreviewMap,
  getCitedItemsSearchLabel,
} from "../src/utils/citedItemsSearch";
import type { CitationContext, IntextCitation } from "../typings/style";

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
    assert.equal(getCitedItemsSearchLabel("word-session-1"), "word-session-1");
  });

  it("builds ordered per-item citation previews from refresh data", function () {
    const contexts = [
      {
        id: "ctx-1",
        page: 1,
        cites: [{ item: { id: 101 } }, { item: { id: 102 } }],
        params: {},
      },
      {
        id: "ctx-2",
        page: 2,
        cites: [{ item: { id: 101 } }],
        params: {},
      },
    ] as unknown as CitationContext[];

    const citations = [
      {
        id: "ctx-1",
        type: "intext-citation",
        source: contexts[0],
        content: { text: "(Smith, 2024)", marks: [] },
      },
      {
        id: "ctx-2",
        type: "intext-citation",
        source: contexts[1],
        content: { text: "(Smith, 2024, p. 10)", marks: [] },
      },
    ] as IntextCitation[];

    const previews = buildDocumentCitationPreviewMap(
      contexts,
      citations,
      (citation) => `<sup>${citation.content.text}</sup>`,
    );

    assert.deepEqual(Array.from(previews.keys()), [101, 102]);
    assert.deepEqual(previews.get(101), {
      htmlParts: [
        "<sup>(Smith, 2024)</sup>",
        "<sup>(Smith, 2024, p. 10)</sup>",
      ],
      text: "(Smith, 2024)  (Smith, 2024, p. 10)",
    });
    assert.deepEqual(previews.get(102), {
      htmlParts: ["<sup>(Smith, 2024)</sup>"],
      text: "(Smith, 2024)",
    });
  });
});
