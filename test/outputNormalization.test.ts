import { assert } from "chai";
import { normalizeGenerateResult } from "../src/modules/sandbox/outputNormalization";
import { applyTextCase } from "../src/modules/unit";
import type { CitationContext } from "../typings/style";
import type { InlineMark, RichText } from "../typings/unit";

const contexts = [
  {
    id: "ctx-1",
    page: 1,
    cites: [{ item: { id: 101 }, params: { locator: "12" } }],
    params: { prefix: "see", sortBy: "cite" },
  },
] as unknown as CitationContext[];

function rich(text: string, marks: InlineMark[] = []): RichText {
  return { text, marks };
}

describe("generate output normalization", function () {
  it("normalizes in-text citations and bibliography from declarative units", function () {
    const result = normalizeGenerateResult(
      {
        citations: [
          {
            id: "ctx-1",
            type: "ignored-by-host",
            content: {
              type: "group",
              units: [
                { value: "smith", italic: true },
                { type: "affix", unit: "2024", prefix: " (", suffix: ")" },
                {
                  type: "when",
                  condition: false,
                  trueUnit: " yes",
                  flseUnit: " no",
                },
              ],
              delimiter: ", ",
            },
          },
        ],
        bibliography: [
          {
            id: "item-1",
            type: "bibliography-entry",
            content: {
              type: "fall",
              units: ["", { value: "Bibliography", bold: true }],
            },
          },
        ],
      },
      contexts,
      "Test Style",
      "intext-citation",
    );

    assert.deepEqual(result.citations, [
      {
        id: "ctx-1",
        type: "intext-citation",
        source: {
          cites: contexts[0].cites,
          params: contexts[0].params,
        },
        content: rich("smith,  (2024),  no", [
          { type: "italic", start: 0, end: 5, value: true },
        ]),
      },
    ]);
    assert.deepEqual(result.bibliography, [
      {
        id: "item-1",
        type: "bibliography-entry",
        content: rich("Bibliography", [
          { type: "bold", start: 0, end: 12, value: true },
        ]),
      },
    ]);
  });

  it("drops affixes when the main unit has no visible text", function () {
    const bibliography = [
      {
        id: "empty-string",
        type: "bibliography-entry",
        content: { type: "affix", unit: "", prefix: "(", suffix: ")" },
      },
      {
        id: "empty-text-unit",
        type: "bibliography-entry",
        content: {
          type: "affix",
          unit: { value: "" },
          prefix: "(",
          suffix: ")",
        },
      },
    ] as unknown[];

    const result = normalizeGenerateResult(
      { citations: [], bibliography },
      contexts,
      "Test Style",
      "intext-citation",
    );

    assert.deepEqual(result.bibliography, [
      { id: "empty-string", type: "bibliography-entry", content: rich("") },
      { id: "empty-text-unit", type: "bibliography-entry", content: rich("") },
    ]);
  });

  it("rejects top-level Unit arrays to keep the script contract explicit", function () {
    assert.throws(
      () =>
        normalizeGenerateResult(
          {
            citations: [{ id: "ctx-1", content: ["A", "B"] }],
            bibliography: [],
          },
          contexts,
          "Test Style",
          "intext-citation",
        ),
      /must be a single Unit.*group\(\[\.\.\.\]\)/,
    );
  });

  it("normalizes note citations with reference content", function () {
    const result = normalizeGenerateResult(
      {
        citations: [
          {
            id: "ctx-1",
            content: "Footnote body",
            reference: { value: "1", script: "superscript" },
          },
        ],
        bibliography: [],
      },
      contexts,
      "Test Style",
      "note-citation",
    );

    assert.deepInclude(result.citations as object[], {
      id: "ctx-1",
      type: "note-citation",
      source: {
        cites: contexts[0].cites,
        params: contexts[0].params,
      },
      content: rich("Footnote body"),
      reference: rich("1", [
        { type: "script", start: 0, end: 1, value: "superscript" },
      ]),
    });
  });

  it("splits supported markup and drops unsafe markup links", function () {
    const result = normalizeGenerateResult(
      {
        citations: [
          {
            id: "ctx-1",
            content: {
              value:
                'A <strong>B</strong><a href="javascript:alert(1)">bad</a><a href="https://example.test/?a=1&amp;b=2">ok</a><br><sup>2</sup>',
            },
          },
        ],
        bibliography: [],
      },
      contexts,
      "Test Style",
      "intext-citation",
    );

    assert.deepEqual(
      (result.citations as { content: unknown }[])[0].content,
      rich("A Bbadok\n2", [
        { type: "bold", start: 2, end: 3, value: true },
        {
          type: "link",
          start: 6,
          end: 8,
          value: "https://example.test/?a=1&b=2",
        },
        { type: "script", start: 9, end: 10, value: "superscript" },
      ]),
    );
  });

  it("applies text case after markup splitting while honoring rich-text case markers", function () {
    const result = normalizeGenerateResult(
      {
        citations: [
          {
            id: "ctx-1",
            content: {
              type: "text-case",
              form: "lower",
              unit: {
                value:
                  'The <i>QUICK <span class="nocase">DNA <b>Seq</b></span></i> and <span style="font-variant: small-caps;">RNA</span>',
              },
            },
          },
        ],
        bibliography: [],
      },
      contexts,
      "Test Style",
      "intext-citation",
    );

    assert.deepEqual(
      (result.citations as { content: unknown }[])[0].content,
      rich(`the quick DNA Seq and ${applyTextCase("RNA", "small-caps")}`, [
        { type: "italic", start: 4, end: 17, value: true },
        { type: "bold", start: 14, end: 17, value: true },
      ]),
    );
  });

  it("turns textCase small-caps into text after markup normalization", function () {
    const result = normalizeGenerateResult(
      {
        citations: [
          {
            id: "ctx-1",
            content: {
              type: "text-case",
              form: "small-caps",
              unit: { value: "Mixed <i>Case</i>" },
            },
          },
        ],
        bibliography: [],
      },
      contexts,
      "Test Style",
      "intext-citation",
    );

    assert.deepEqual(
      (result.citations as { content: unknown }[])[0].content,
      rich(
        `${applyTextCase("Mixed ", "small-caps")}${applyTextCase("Case", "small-caps")}`,
        [{ type: "italic", start: 6, end: 10, value: true }],
      ),
    );
  });

  it("reports unmatched citation ids", function () {
    assert.throws(
      () =>
        normalizeGenerateResult(
          {
            citations: [{ id: "missing", content: "x" }],
            bibliography: [],
          },
          contexts,
          "Test Style",
          "intext-citation",
        ),
      /cannot be matched to input contexts/,
    );
  });
});
