import { assert } from "chai";
import { normalizeGenerateResult } from "../src/modules/sandbox/outputNormalization";
import { applyTextCase } from "../src/modules/unit";
import type { CitationContext } from "../typings/style";

const contexts = [
  {
    id: "ctx-1",
    page: 1,
    cites: [{ item: { id: 101 }, params: { locator: "12" } }],
    params: { prefix: "see", sortBy: "cite" },
  },
] as unknown as CitationContext[];

describe("generate output normalization", function () {
  it("normalizes in-text citations and bibliography from declarative units", function () {
    const result = normalizeGenerateResult(
      {
        citations: [
          {
            id: "ctx-1",
            type: "ignored-by-host",
            units: {
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
            units: {
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
        units: [{ value: "smith", italic: true }, { value: ",  (2024),  no" }],
      },
    ]);
    assert.deepEqual(result.bibliography, [
      {
        id: "item-1",
        type: "bibliography-entry",
        units: [{ value: "Bibliography", bold: true }],
      },
    ]);
  });

  it("rejects top-level Unit arrays to keep the script contract explicit", function () {
    assert.throws(
      () =>
        normalizeGenerateResult(
          {
            citations: [{ id: "ctx-1", units: ["A", "B"] }],
            bibliography: [],
          },
          contexts,
          "Test Style",
          "intext-citation",
        ),
      /must be a single Unit.*group\(\[\.\.\.\]\)/,
    );
  });

  it("normalizes note citations with reference units", function () {
    const result = normalizeGenerateResult(
      {
        citations: [
          {
            id: "ctx-1",
            units: "Footnote body",
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
      units: [{ value: "Footnote body" }],
      reference: [{ value: "1", script: "superscript" }],
    });
  });

  it("splits supported markup and drops unsafe markup links", function () {
    const result = normalizeGenerateResult(
      {
        citations: [
          {
            id: "ctx-1",
            units: {
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

    assert.deepEqual((result.citations as { units: unknown }[])[0].units, [
      { value: "A " },
      { value: "B", bold: true },
      { value: "bad" },
      { value: "ok", link: "https://example.test/?a=1&b=2" },
      { value: "\n" },
      { value: "2", script: "superscript" },
    ]);
  });

  it("applies text case after markup splitting while honoring rich-text case markers", function () {
    const result = normalizeGenerateResult(
      {
        citations: [
          {
            id: "ctx-1",
            units: {
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

    assert.deepEqual((result.citations as { units: unknown }[])[0].units, [
      { value: "the " },
      { value: "quick ", italic: true },
      { value: "DNA ", italic: true },
      { value: "Seq", italic: true, bold: true },
      { value: " and " },
      { value: applyTextCase("RNA", "small-caps") },
    ]);
  });

  it("turns textCase small-caps into text after markup normalization", function () {
    const result = normalizeGenerateResult(
      {
        citations: [
          {
            id: "ctx-1",
            units: {
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

    assert.deepEqual((result.citations as { units: unknown }[])[0].units, [
      { value: applyTextCase("Mixed ", "small-caps") },
      { value: applyTextCase("Case", "small-caps"), italic: true },
    ]);
  });

  it("reports unmatched citation ids", function () {
    assert.throws(
      () =>
        normalizeGenerateResult(
          {
            citations: [{ id: "missing", units: "x" }],
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
