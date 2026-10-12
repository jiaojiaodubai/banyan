import { assert } from "chai";
import js from "@eslint/js";
import { ESLint } from "eslint";
import banyanStyle, {
  CSL_NAME_VARIABLES as LINT_CSL_NAME_VARIABLES,
  PRESET_DENIED_KEYS as LINT_DENIED_KEYS,
} from "../addon/content/styleEditor/eslint-plugin-banyan-style.mjs";
import {
  CSL_NAME_VARIABLES,
  DENIED_KEYS,
} from "../src/modules/sandbox/fieldPresets";
import { normalizeExtraKey } from "../src/utils/item";

async function lintStyleScript(code: string) {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      js.configs.recommended,
      {
        files: ["**/*.js"],
        languageOptions: {
          ecmaVersion: 2022,
          sourceType: "script",
          globals: {
            contexts: "readonly",
          },
        },
        plugins: {
          banyanStyle: banyanStyle as never,
        },
        rules: {
          "no-unused-vars": "off",
          "banyanStyle/require-style-contract": "error",
          "banyanStyle/warn-risky-runtime-pattern": "warn",
          "banyanStyle/validate-field-presets": "error",
        },
      },
    ],
  });
  return eslint.lintText(code, { filePath: "style.js" });
}

const validInfo = `
const INFO = {
  id: "test-style",
  title: "Test Style",
  description: "For lint tests",
  citationType: "intext-citation",
  creator: [{ type: "author", name: "Tester" }],
  tags: [],
  documentation: [],
  license: "MIT",
  updated: "2026-06-15",
};
`;

describe("style author lint rules", function () {
  it("accepts the documented minimal style contract", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
function generate() {
  return { citations: contexts.map((ctx) => ({ id: ctx.id, content: "" })), bibliography: [] };
}
`);

    assert.deepEqual(result.messages, []);
  });

  it("reports missing INFO and generate entries", async function () {
    const [result] = await lintStyleScript(`const helper = () => null;`);

    assert.includeMembers(
      result.messages.map((message) => message.messageId),
      ["missingEntries"],
    );
    assert.match(result.messages[0].message, /INFO, generate/);
  });

  it("validates INFO fields that are part of the authoring contract", async function () {
    const [result] = await lintStyleScript(`
const INFO = {
  id: "bad-style",
  title: "Bad Style",
  description: "Bad",
  citationType: "bibliography-only",
  creator: [{ type: "author" }],
  tags: "style",
  documentation: [],
  license: "MIT",
  updated: 20260615,
};
function generate() { return { citations: [], bibliography: [] }; }
`);

    assert.includeMembers(
      result.messages.map((message) => message.messageId),
      [
        "infoFieldMustBeArray",
        "infoFieldMustBeString",
        "infoCitationTypeInvalid",
        "creatorMissingFields",
      ],
    );
  });

  it("warns about sandbox reliability risks described in the guidelines", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
function generate() {
  while (true) break;
  for (;;) break;
  for (let i = 0; i < 100000; i++) {}
  return recur();
}
function recur() {
  return recur();
}
`);

    assert.includeMembers(
      result.messages.map((message) => message.messageId),
      ["unboundedWhile", "unboundedFor", "largeSyncLoop", "directRecursion"],
    );
  });

  it("accepts a well-formed ITEM_FIELD_PRESETS declaration", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
const ITEM_FIELD_PRESETS = [
  {
    id: "classic",
    label: "古籍",
    visible: (item) => item.itemType === "book",
    fields: { type: "classic" },
  },
  {
    id: "foreign-law",
    label: "外国法（补法域）",
    fields: { jurisdiction: null },
  },
];
function generate() { return { citations: [], bibliography: [] }; }
`);

    assert.deepEqual(result.messages, []);
  });

  it("validates ITEM_FIELD_PRESETS shape and writable keys", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
const ITEM_FIELD_PRESETS = [
  {
    id: "dup",
    label: { "zh-CN": "古籍" },
    visible: "always",
    fields: { extra: "x", author: "Someone", type: 42, status: "" },
  },
  { id: "dup", fields: {} },
  { id: "", label: "无名", fields: { type: "classic" } },
];
function generate() { return { citations: [], bibliography: [] }; }
`);

    assert.includeMembers(
      result.messages.map((message) => message.messageId),
      [
        "presetLabelInvalid",
        "presetVisibleInvalid",
        "fieldKeyDenied",
        "fieldKeyIsNameVariable",
        "fieldValueInvalid",
        "presetIdDuplicate",
        "fieldsMustBeNonEmptyObject",
        "presetIdInvalid",
      ],
    );
  });

  it("accepts a ITEM_FIELD_PRESETS object map and validates its entries", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
const ITEM_FIELD_PRESETS = {
  classic: { id: "classic", fields: { type: "classic" } },
  broken: { id: "", fields: {} },
};
function generate() { return { citations: [], bibliography: [] }; }
`);

    assert.deepEqual(
      result.messages.map((message) => message.messageId),
      ["presetIdInvalid", "fieldsMustBeNonEmptyObject"],
    );
  });

  it("rejects keys that cannot be read back from the extra field", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
const ITEM_FIELD_PRESETS = [
  { id: "dots", fields: { "citation.key": "x", "版本说明2": "y", status: "z" } },
];
function generate() { return { citations: [], bibliography: [] }; }
`);

    assert.deepEqual(
      result.messages.map((message) => message.messageId),
      ["fieldKeyInvalidSyntax"],
    );
  });

  it("rejects a ITEM_FIELD_PRESETS that is neither an array nor an object map", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
const ITEM_FIELD_PRESETS = "classic";
function generate() { return { citations: [], bibliography: [] }; }
`);

    assert.includeMembers(
      result.messages.map((message) => message.messageId),
      ["presetsMustBeArray"],
    );
  });

  // The rule cannot import the runtime, so the two lists are copies; an entry
  // missing on either side would be a silent no-op at apply time.
  describe("rule/runtime parity", function () {
    it("denies exactly the keys the runtime denies", function () {
      assert.deepEqual(
        [...LINT_DENIED_KEYS].sort(),
        [...DENIED_KEYS].map(normalizeExtraKey).sort(),
      );
    });

    it("carries exactly the CSL name variables of the runtime", function () {
      assert.deepEqual(
        [...LINT_CSL_NAME_VARIABLES].sort(),
        [...CSL_NAME_VARIABLES].sort(),
      );
    });

    it("reports every denied key, and only those", async function () {
      for (const key of DENIED_KEYS) {
        const [result] = await lintStyleScript(`
${validInfo}
const ITEM_FIELD_PRESETS = [{ id: "mark", fields: { ${JSON.stringify(key)}: "x" } }];
function generate() { return { citations: [], bibliography: [] }; }
`);

        assert.deepEqual(
          result.messages.map((message) => message.messageId),
          ["fieldKeyDenied"],
          `'${key}' must be reported as a denied key`,
        );
      }

      // Keys the runtime accepts must stay accepted, whether or not they are
      // Zotero fields.
      for (const key of [
        "status",
        "jurisdiction",
        "citation-key",
        "版本说明2",
      ]) {
        const [result] = await lintStyleScript(`
${validInfo}
const ITEM_FIELD_PRESETS = [{ id: "mark", fields: { ${JSON.stringify(key)}: "x" } }];
function generate() { return { citations: [], bibliography: [] }; }
`);

        assert.deepEqual(
          result.messages.map((message) => message.messageId),
          [],
          `'${key}' must be accepted`,
        );
      }
    });
  });
});
