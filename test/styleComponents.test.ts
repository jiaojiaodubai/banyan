import { assert } from "chai";
import { normalizeComponents } from "../src/modules/sandbox/styleComponents";

const globals = globalThis as Record<string, unknown>;
const originalZotero = globals.Zotero;
const originalCu = globals.Cu;
const originalZtoolkit = globals.ztoolkit;

describe("style UI component normalization", function () {
  const sandbox = {};

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
      logError() {
        // Keep predicate diagnostics quiet in tests.
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
        {
          id: "showDOI",
          type: "checkbox",
          label: "Show DOI",
          value: "true",
          disabled: true,
        },
        { id: "prefix", type: "input", label: "Prefix", value: 123 },
        {
          id: "mode",
          type: "select",
          label: "Mode",
          options: { short: "Short", full: "Full" },
        },
      ],
      {},
      sandbox,
      globals.Cu as never,
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

  it("normalizes cite visibility and disabled callbacks", function () {
    const result = normalizeComponents(
      {
        visible: {
          id: "locator",
          type: "input",
          label: "Locator",
          value: "",
          visible: (item: { itemType: string }) => item.itemType === "book",
          disabled: (cite: { params?: { mode?: string } }) =>
            cite.params?.mode === "locked",
        },
        missingId: { type: "input", label: "Missing ID", value: "x" },
        unsupported: {
          id: "custom",
          type: "slider",
          label: "Custom",
          value: 1,
        },
      },
      {},
      sandbox,
      globals.Cu as never,
      "cite",
    );

    assert.equal(result?.length, 1);
    const component = result?.[0];
    assert.equal(component?.id, "locator");
    const visibility =
      component && "visible" in component ? component.visible : undefined;
    assert.isFunction(visibility);
    assert.isTrue(visibility!({ id: 1, itemType: "book" } as never));
    assert.isFalse(visibility!({ id: 1, itemType: "journalArticle" } as never));
    const disabled =
      component && "disabled" in component ? component.disabled : undefined;
    assert.isFunction(disabled);
    const disabledPredicate = disabled as (cite: {
      item: object;
      params?: { mode?: string };
    }) => boolean;
    assert.isFalse(disabledPredicate({ item: {}, params: { mode: "open" } }));
    assert.isTrue(disabledPredicate({ item: {}, params: { mode: "locked" } }));
  });
});
