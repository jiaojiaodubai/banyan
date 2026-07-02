import { assert } from "chai";
import { normalizeComponents } from "../src/modules/sandbox/styleComponents";

const globals = globalThis as Record<string, unknown>;
const originalZotero = globals.Zotero;
const originalCu = globals.Cu;
const originalZtoolkit = globals.ztoolkit;

describe("style UI component normalization", function () {
  beforeEach(function () {
    globals.Zotero = {
      getMainWindow() {
        return { Cu: { waiveXrays: (value: unknown) => value } };
      },
    };
    globals.Cu = {
      cloneInto: (value: unknown) => value,
    };
    globals.ztoolkit = {
      log() {
        // Keep invalid-component diagnostics quiet in tests.
      },
    };
  });

  afterEach(function () {
    globals.Zotero = originalZotero;
    globals.Cu = originalCu;
    globals.ztoolkit = originalZtoolkit;
  });

  it("normalizes documented checkbox, input, and select controls", function () {
    const result = normalizeComponents(
      [
        { id: "showDOI", type: "checkbox", label: "Show DOI", value: "true" },
        { id: "prefix", type: "input", label: "Prefix", value: 123 },
        {
          id: "mode",
          type: "select",
          label: "Mode",
          options: { short: "Short", full: "Full" },
        },
      ],
      {},
      "citation",
    );

    assert.deepEqual(result, [
      { id: "showDOI", label: "Show DOI", type: "checkbox", value: true },
      { id: "prefix", label: "Prefix", type: "input", value: "123" },
      {
        id: "mode",
        label: "Mode",
        type: "select",
        value: "short",
        options: { short: "Short", full: "Full" },
      },
    ]);
  });

  it("accepts object-map UI definitions and filters invalid controls", function () {
    const result = normalizeComponents(
      {
        valid: { id: "suffix", type: "input", label: "Suffix", value: "" },
        missingId: { type: "input", label: "Missing ID", value: "x" },
        unsupported: {
          id: "custom",
          type: "slider",
          label: "Custom",
          value: 1,
        },
      },
      {},
      "citation",
    );

    assert.deepEqual(result, [
      { id: "suffix", label: "Suffix", type: "input", value: "" },
    ]);
  });

  it("keeps itemType constraints only for cite-scoped controls", function () {
    const citeResult = normalizeComponents(
      [
        {
          id: "locator",
          type: "input",
          label: "Locator",
          value: "",
          itemType: ["book", "", "journalArticle"],
        },
      ],
      {},
      "cite",
    );
    const citationResult = normalizeComponents(
      [
        {
          id: "sortBy",
          type: "input",
          label: "Sort By",
          value: "cite",
          itemType: ["book"],
        },
      ],
      {},
      "citation",
    );

    assert.deepEqual(citeResult, [
      {
        id: "locator",
        label: "Locator",
        itemType: ["book", "journalArticle"],
        type: "input",
        value: "",
      },
    ]);
    assert.deepEqual(citationResult, [
      { id: "sortBy", label: "Sort By", type: "input", value: "cite" },
    ]);
  });
});
