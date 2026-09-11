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

const globals = globalThis as Record<string, unknown>;
const originalDomParser = globals.DOMParser;
const originalZtoolkit = globals.ztoolkit;

/**
 * Markup splitting resolves `DOMParser` either from the ambient global (host
 * windows, the in-Zotero test page) or from the main window via `ztoolkit`
 * (the plugin sandbox, which strips DOM globals). A plain Node runner has
 * neither, so tests that assert parsed markup must skip instead of reporting
 * an environment gap as a product failure.
 */
function requireDomParser(context: Mocha.Context): void {
  if (typeof originalDomParser !== "function") {
    context.skip();
  }
}

function rich(text: string, marks: InlineMark[] = []): RichText {
  return { text, marks };
}

/** Normalize one citation content unit and return the single content line. */
function contentOf(unit: unknown): unknown {
  const result = normalizeGenerateResult(
    { citations: [{ id: "ctx-1", content: unit }], bibliography: [] },
    contexts,
    "Test Style",
    "intext-citation",
  );
  return (result.citations as { content: unknown }[])[0].content;
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
            id: "references",
            type: "bibliography-title",
            content: "References",
          },
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
        id: "references",
        type: "bibliography-title",
        content: rich("References"),
      },
      {
        id: "item-1",
        type: "bibliography-entry",
        content: rich("Bibliography", [
          { type: "bold", start: 0, end: 12, value: true },
        ]),
      },
    ]);
  });

  it("requires an id for bibliography titles", function () {
    assert.throws(
      () =>
        normalizeGenerateResult(
          {
            citations: [],
            bibliography: [
              { type: "bibliography-title", content: "References" },
            ],
          },
          contexts,
          "Test Style",
          "intext-citation",
        ),
      /bibliography\[0\]\.id must be a non-empty string\./,
    );
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
    // Markup splitting needs a DOMParser; a DOM-less Node run cannot exercise
    // it. The sandbox/host differences are covered in the dedicated suite below.
    requireDomParser(this);

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
    requireDomParser(this);

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
    requireDomParser(this);

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

  describe("markup splitting across sandbox and host environments", function () {
    afterEach(function () {
      globals.DOMParser = originalDomParser;
      globals.ztoolkit = originalZtoolkit;
    });

    const markup =
      'A <strong>B</strong><a href="https://example.test/?a=1&amp;b=2">ok</a><br><sup>2</sup>';

    function expectedMarkup(): RichText {
      return rich("A Bok\n2", [
        { type: "bold", start: 2, end: 3, value: true },
        {
          type: "link",
          start: 3,
          end: 5,
          value: "https://example.test/?a=1&b=2",
        },
        { type: "script", start: 6, end: 7, value: "superscript" },
      ]);
    }

    it("uses the ambient DOMParser without touching ztoolkit when one exists", function () {
      // Host-like environments (dialogs, the in-Zotero test page) expose
      // DOMParser directly, so the ztoolkit fallback must stay unused. This
      // branch is only meaningful where the host provides an ambient parser.
      requireDomParser(this);

      let requested: string | undefined;
      globals.DOMParser = originalDomParser;
      globals.ztoolkit = {
        getGlobal(name: string) {
          requested = name;
          return undefined;
        },
      };

      assert.deepEqual(contentOf({ value: markup }), expectedMarkup());
      assert.isUndefined(requested);
    });

    it("falls back to the main window DOMParser inside the plugin sandbox", function () {
      // The plugin sandbox strips DOM globals (sandbox.document/window are
      // undefined), so markup splitting must resolve DOMParser via ztoolkit.
      delete globals.DOMParser;

      let requested: string | undefined;
      globals.ztoolkit = {
        getGlobal(name: string) {
          requested = name;
          return originalDomParser;
        },
      };

      // In a DOM-less Node run ztoolkit yields no parser, so markup degrades to
      // decoded literal text; only the request itself is guaranteed here.
      const result =
        typeof originalDomParser === "function"
          ? expectedMarkup()
          : rich(
              'A <strong>B</strong><a href="https://example.test/?a=1&b=2">ok</a><br><sup>2</sup>',
            );

      assert.deepEqual(contentOf({ value: markup }), result);
      assert.equal(requested, "DOMParser");
    });

    it("keeps markup readable as plain text when no DOMParser is reachable", function () {
      // Neither an ambient DOMParser nor a ztoolkit bridge: parseHTMLContainer
      // returns null and the markup must degrade to decoded literal text instead
      // of throwing or silently dropping content.
      delete globals.DOMParser;
      globals.ztoolkit = { getGlobal: () => undefined };

      assert.deepEqual(
        contentOf({ value: "A <strong>B</strong> &amp; C" }),
        rich("A <strong>B</strong> & C"),
      );
    });

    it("keeps markup readable when DOMParser construction throws", function () {
      delete globals.DOMParser;
      globals.ztoolkit = {
        getGlobal() {
          return class {
            parseFromString() {
              throw new Error("parser unavailable");
            }
          } as unknown as typeof DOMParser;
        },
      };

      assert.deepEqual(contentOf({ value: "A <i>B</i>" }), rich("A <i>B</i>"));
    });

    it("decodes entities even when no parser is available", function () {
      delete globals.DOMParser;
      globals.ztoolkit = { getGlobal: () => undefined };

      assert.deepEqual(
        contentOf({ value: "Tom &amp; Jerry &lt;3 &nbsp;end" }),
        rich("Tom & Jerry <3  end"),
      );
    });
  });
});
