import { assert } from "chai";
import js from "@eslint/js";
import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";
import {
  CSL_NAME_VARIABLES as LINT_CSL_NAME_VARIABLES,
  PRESET_DENIED_KEYS as LINT_DENIED_KEYS,
  createBanyanStyleConfig,
} from "../addon/content/styleEditor/eslint-plugin-banyan-style.mjs";
import { CSL_NAME_VARIABLES } from "@banyan/core/schema/cslSchema";
import { DENIED_KEYS } from "@banyan/core/validation/fieldPresets";
import { normalizeExtraKey } from "@banyan/core/items/extra";

const typingsDir = fileURLToPath(
  new URL("../addon/content/styleEditor/", import.meta.url),
);

async function lintStyleScript(code: string) {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      js.configs.recommended,
      createBanyanStyleConfig({ typingsDir }),
    ],
  });
  return eslint.lintText(code, { filePath: "style.js" });
}

const validInfo = `
const INFO = {
  id: "test-style",
  title: "Test Style",
  description: "For lint parity tests",
  citationType: "intext-citation",
  creator: [{ type: "author", name: "Tester" }],
  tags: [],
  documentation: [],
  license: "MIT",
  updated: "2026-10-25",
};
`;

describe("style lint", function () {
  // The rule cannot import the runtime, so the two lists are copies; an entry
  // missing on either side would be a silent no-op at apply time. The rule
  // behavior itself is covered by the standalone package's test suite.
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

  describe("shipped asset", function () {
    it("lints the documented minimal style", async function () {
      const [result] = await lintStyleScript(`
${validInfo}
function generate() {
  return {
    citations: contexts.map((context) => ({ id: context.id, content: "" })),
    bibliography: [],
  };
}
`);

      assert.deepEqual(result.messages, []);
    });
  });
});
