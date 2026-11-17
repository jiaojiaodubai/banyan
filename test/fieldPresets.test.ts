import { assert } from "chai";
import {
  getFieldPresetMenuLabel,
  hasDeferredFieldValues,
  normalizeFieldPresets,
} from "@banyan/core/validation/fieldPresets";
import type { StyleMessageReporter } from "@banyan/core/messages";
import { createStyleMessageReporter } from "@banyan/core/messages";
import { createIdentitySandboxContext } from "./helpers/sandboxContext";

// The core hands what it notices back as diagnostics instead of printing.
const context = createIdentitySandboxContext();

describe("field preset normalization", function () {
  const normalize = (
    raw: unknown,
    messages: StyleMessageReporter = createStyleMessageReporter(),
  ) => normalizeFieldPresets(raw, context, messages);

  it("normalizes documented entries and their labels", function () {
    const result = normalize([
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
    ]);

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
    assert.isTrue(
      result![1].visible!({ id: "1", itemType: "book", creators: [] }),
    );
  });

  it("rejects the object-map form the runtime no longer accepts", function () {
    const messages = createStyleMessageReporter();
    const result = normalize(
      { entry: { id: "classic", fields: { type: "classic" } } },
      messages,
    );

    assert.isUndefined(result);
    assert.include(
      messages.diagnostics.map((message) => message.message),
      "ITEM_FIELD_PRESETS must be an array; ignored",
    );
  });

  it("falls back to the id for a non-string label", function () {
    const result = normalize([
      { id: "locale-map", label: { "zh-CN": "古籍" }, fields: { type: "x" } },
      { id: "number", label: 42, fields: { type: "x" } },
    ]);

    assert.deepEqual(
      result?.map((preset) => preset.label),
      ["locale-map", "number"],
    );
  });

  it("keeps null values as 'ask the user at apply time'", function () {
    const result = normalize([
      {
        id: "foreign-law",
        label: "外国法",
        fields: { jurisdiction: null, type: "regulation" },
      },
    ]);

    assert.deepEqual(result?.[0].fields, {
      jurisdiction: null,
      type: "regulation",
    });
    assert.isTrue(hasDeferredFieldValues(result![0]));
    assert.equal(getFieldPresetMenuLabel(result![0]), "外国法…");
  });

  it("leaves the menu label alone when every value is fixed", function () {
    const result = normalize([
      { id: "classic", label: "古籍", fields: { type: "classic" } },
    ]);

    assert.isFalse(hasDeferredFieldValues(result![0]));
    assert.equal(getFieldPresetMenuLabel(result![0]), "古籍");
  });

  it("drops unusable entries instead of failing the style", function () {
    const result = normalize([
      { id: "", fields: { type: "classic" } },
      { id: "dup", fields: { type: "classic" } },
      { id: "dup", fields: { type: "other" } },
      { id: "empty-fields", fields: {} },
      { id: "not-an-object-field", fields: "type: classic" },
    ]);

    assert.deepEqual(
      result?.map((preset) => preset.id),
      ["dup"],
    );
  });

  it("rejects values and keys that must not be written", function () {
    const result = normalize([
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
    ]);

    assert.deepEqual(result?.[0].fields, { type: "classic" });
  });

  it("drops invalid keys so an unusable preset is not indexed", function () {
    const result = normalize([
      {
        id: "invalid-key",
        fields: { "citation.key": "x" },
      },
      {
        id: "mixed-keys",
        fields: { "citation.key": "x", status: "advance" },
      },
    ]);

    assert.deepEqual(
      result?.map((preset) => preset.id),
      ["mixed-keys"],
    );
    assert.deepEqual(result?.[0].fields, { status: "advance" });
  });

  it("treats a throwing visibility predicate as not visible", function () {
    const result = normalize([
      {
        id: "boom",
        fields: { type: "classic" },
        visible: () => {
          throw new Error("boom");
        },
      },
    ]);

    assert.isFalse(
      result![0].visible!({ id: "1", itemType: "book", creators: [] }),
    );
  });

  it("returns undefined when nothing is declared", function () {
    assert.isUndefined(normalize([]));
    assert.isUndefined(normalize(undefined));
  });

  it("extracts ITEM_FIELD_PRESETS through the style sandbox", async function () {
    // This path needs the real host: the core builds a sandbox through
    // `geckoSandboxRuntime` and the Zotero capabilities.
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
    assert.isTrue(preset.visible!({ id: "1", itemType: "book", creators: [] }));
    assert.isFalse(
      preset.visible!({ id: "2", itemType: "journalArticle", creators: [] }),
    );
  });

  it("runs a style that uses the sandbox console", async function () {
    // The Gecko sandbox has a console of its own; the core has to replace it, or
    // a style's `console.log` would leave the sandbox instead of going through
    // the host. This pins the real thing: level routing, `assert`, the methods
    // that only exist so a familiar call cannot throw, and the fact that a
    // warning does not abort the run.
    const { createStyle } = await import("../src/modules/sandbox");
    const style = await createStyle(`
      const INFO = {
        id: "console-probe",
        title: "Console Probe",
        description: "",
        citationType: "intext-citation",
        creator: [],
        tags: [],
        documentation: [],
        license: "MIT",
        updated: "2026-01-01",
      };
      function generate() {
        console.debug("debug line");
        console.log("log line", { n: 1 });
        console.trace("trace line");
        console.info("info line");
        console.warn("warn line");
        console.error("error line");
        console.assert(true, "not reported");
        console.assert(false, "assertion detail");
        console.count("x");
        console.group("g");
        console.groupEnd();
        console.time("t");
        console.timeEnd("t");
        console.clear();
        console.dir({ a: 1 });
        console.table([{ a: 1 }]);
        return { citations: [{ id: "ctx-1", content: "kept" }], bibliography: [] };
      }
    `);

    const result = await style.generate([
      { id: "ctx-1", page: 0, cites: [], params: {} },
    ]);

    assert.equal(
      (result.citations as { content: { text: string } }[])[0].content.text,
      "kept",
    );
    assert.deepEqual(
      style.diagnostics.map((message) => message.severity),
      ["info", "warning", "error", "error"],
    );
    assert.deepEqual(
      style.diagnostics.map((message) => message.message),
      [
        "info line",
        "warn line",
        "error line",
        "Assertion failed assertion detail",
      ],
    );
    assert.isTrue(
      style.diagnostics.every(
        (message) => message.source === "style" && message.code === "generate",
      ),
    );
  });
});
