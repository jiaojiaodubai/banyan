import { assert } from "chai";
import js from "@eslint/js";
import { ESLint } from "eslint";
import banyanStyle from "../addon/content/styleEditor/eslint-plugin-banyan-style.mjs";

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
});
