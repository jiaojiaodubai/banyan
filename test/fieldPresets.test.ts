import { assert } from "chai";
import {
  getFieldPresetMenuLabel,
  hasDeferredFieldValues,
  normalizeFieldPresets,
} from "../src/modules/sandbox/fieldPresets";

// Mirrors `citationControls.test.ts`: the module only needs `Cu` for
// waiveXrays/cloneInto and `ztoolkit` for diagnostics.
const globals = globalThis as Record<string, unknown>;
const realZotero = globals.Zotero;
const realCu = globals.Cu;
const realZtoolkit = globals.ztoolkit;

describe("field preset normalization", function () {
  const sandbox = {};

  beforeEach(function () {
    globals.Zotero = {
      getMainWindow() {
        return { Cu: { waiveXrays: (value: unknown) => value } };
      },
      CreatorTypes: { getID: () => false },
      ItemTypes: { getID: () => false },
    };
    globals.Cu = {
      waiveXrays: (value: unknown) => value,
      cloneInto: (value: unknown) => value,
    };
    globals.ztoolkit = {
      log() {
        // Keep invalid-preset diagnostics quiet in tests.
      },
      logError() {
        // Keep invalid-preset diagnostics quiet in tests.
      },
    };
  });

  afterEach(function () {
    globals.Zotero = realZotero;
    globals.Cu = realCu;
    globals.ztoolkit = realZtoolkit;
  });

  it("normalizes documented entries and their labels", function () {
    const result = normalizeFieldPresets(
      [
        {
          id: "classic",
          label: "古籍",
          fields: { type: "classic" },
        },
        {
          id: "plain",
          label: "  Plain label  ",
          visible: () => true,
          fields: { status: "advance online publication" },
        },
      ],
      {},
      sandbox,
      globals.Cu as never,
    );

    assert.deepEqual(
      result?.map((preset) => ({
        id: preset.id,
        label: preset.label,
        fields: preset.fields,
      })),
      [
        {
          id: "classic",
          label: "古籍",
          fields: { type: "classic" },
        },
        {
          id: "plain",
          label: "Plain label",
          fields: { status: "advance online publication" },
        },
      ],
    );
    assert.isFunction(result?.[1].visible);
    assert.isTrue(result![1].visible!({ id: 1 } as never));
  });

  it("accepts an object map and falls back to the id as label", function () {
    const result = normalizeFieldPresets(
      { entry: { id: "classic", fields: { type: "classic" } } },
      {},
      sandbox,
      globals.Cu as never,
    );

    assert.equal(result?.length, 1);
    assert.equal(result?.[0].label, "classic");
  });

  it("falls back to the id for a non-string label", function () {
    const result = normalizeFieldPresets(
      [
        { id: "locale-map", label: { "zh-CN": "古籍" }, fields: { type: "x" } },
        { id: "number", label: 42, fields: { type: "x" } },
      ],
      {},
      sandbox,
      globals.Cu as never,
    );

    assert.deepEqual(
      result?.map((preset) => preset.label),
      ["locale-map", "number"],
    );
  });

  it("keeps null values as 'ask the user at apply time'", function () {
    const result = normalizeFieldPresets(
      [
        {
          id: "foreign-law",
          label: "外国法",
          fields: { jurisdiction: null, type: "regulation" },
        },
      ],
      {},
      sandbox,
      globals.Cu as never,
    );

    assert.deepEqual(result?.[0].fields, {
      jurisdiction: null,
      type: "regulation",
    });
    assert.isTrue(hasDeferredFieldValues(result![0]));
    assert.equal(getFieldPresetMenuLabel(result![0]), "外国法…");
  });

  it("leaves the menu label alone when every value is fixed", function () {
    const result = normalizeFieldPresets(
      [{ id: "classic", label: "古籍", fields: { type: "classic" } }],
      {},
      sandbox,
      globals.Cu as never,
    );

    assert.isFalse(hasDeferredFieldValues(result![0]));
    assert.equal(getFieldPresetMenuLabel(result![0]), "古籍");
  });

  it("drops unusable entries instead of failing the style", function () {
    const result = normalizeFieldPresets(
      [
        { id: "", fields: { type: "classic" } },
        { id: "dup", fields: { type: "classic" } },
        { id: "dup", fields: { type: "other" } },
        { id: "empty-fields", fields: {} },
        { id: "not-an-object-field", fields: "type: classic" },
      ],
      {},
      sandbox,
      globals.Cu as never,
    );

    assert.deepEqual(
      result?.map((preset) => preset.id),
      ["dup"],
    );
  });

  it("rejects values and keys that must not be written", function () {
    const result = normalizeFieldPresets(
      [
        {
          id: "mixed",
          fields: {
            type: "classic",
            status: "",
            note: 42,
            extra: "x",
            key: "x",
            dateAdded: "2020-01-01",
          },
        },
      ],
      {},
      sandbox,
      globals.Cu as never,
    );

    assert.deepEqual(result?.[0].fields, { type: "classic" });
  });

  it("drops invalid keys so an unusable preset is not indexed", function () {
    const result = normalizeFieldPresets(
      [
        {
          id: "invalid-key",
          fields: { "citation.key": "x" },
        },
        {
          id: "mixed-keys",
          fields: { "citation.key": "x", status: "advance" },
        },
      ],
      {},
      sandbox,
      globals.Cu as never,
    );

    assert.deepEqual(
      result?.map((preset) => preset.id),
      ["mixed-keys"],
    );
    assert.deepEqual(result?.[0].fields, { status: "advance" });
  });

  it("treats a throwing visibility predicate as not visible", function () {
    const result = normalizeFieldPresets(
      [
        {
          id: "boom",
          fields: { type: "classic" },
          visible: () => {
            throw new Error("boom");
          },
        },
      ],
      {},
      sandbox,
      globals.Cu as never,
    );

    assert.isFalse(result![0].visible!({ id: 1 } as never));
  });

  it("returns undefined when nothing is declared", function () {
    assert.isUndefined(
      normalizeFieldPresets([], {}, sandbox, globals.Cu as never),
    );
    assert.isUndefined(
      normalizeFieldPresets(undefined, {}, sandbox, globals.Cu as never),
    );
  });

  it("extracts ITEM_FIELD_PRESETS through the style sandbox", async function () {
    // The sandbox needs the real `Cu`/`Zotero`/`ztoolkit`: the stubs above only
    // cover the pure normalization checks.
    const scope = globalThis as Record<string, unknown>;
    const banyan = (
      realZotero as { Banyan?: { data?: { ztoolkit?: unknown } } } | undefined
    )?.Banyan;
    scope.Zotero = realZotero;
    scope.Cu = realCu;
    scope.ztoolkit = realZtoolkit ?? banyan?.data?.ztoolkit;

    const { createStyle } = await import("../src/modules/sandbox");
    const style = await createStyle(`
      const INFO = {
        id: "preset-probe",
        title: "Preset Probe",
        description: "",
        citationType: "intext-citation",
        creator: [],
        tags: [],
        documentation: [],
        license: "MIT",
        updated: "2026-01-01",
      };
      const ITEM_FIELD_PRESETS = [
        {
          id: "classic",
          label: "古籍",
          visible: (item) => item.itemType === "book",
          fields: { type: "classic", note: 1, extra: "x" },
        },
      ];
      function generate() {
        return { citations: [], bibliography: [] };
      }
    `);

    assert.equal(style.ITEM_FIELD_PRESETS?.length, 1);
    const preset = style.ITEM_FIELD_PRESETS![0];
    assert.equal(preset.id, "classic");
    assert.equal(preset.label, "古籍");
    assert.equal(preset.fields.type, "classic");
    // Non-string values and unwritable keys are dropped during bridging.
    assert.deepEqual(Object.keys(preset.fields), ["type"]);
    assert.isFunction(preset.visible);
    assert.isTrue(preset.visible!({ itemType: "book" } as never));
    assert.isFalse(preset.visible!({ itemType: "journalArticle" } as never));
  });
});
