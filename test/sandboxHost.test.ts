import { assert } from "chai";
import type { StyleResult } from "@banyan/core/types/style";
import type {
  CitationContext,
  Cite,
  ScriptItem,
} from "@banyan/core/types/style";
import {
  resolveCiteParamValues,
  resolveStyleOptionState,
} from "@banyan/core/validation/paramValues";
import { ensureDataDir } from "../src/modules/styles";
import { createStyle, zoteroStyleHost } from "../src/modules/sandbox";
import { zoteroCapabilities } from "../src/modules/sandbox/capabilities";

const INFO = `
const INFO = {
  id: "host-contract-probe",
  title: "Host contract probe",
  description: "",
  citationType: "intext-citation",
  creator: [],
  tags: [],
  documentation: [],
  license: "MIT",
  updated: "2026-10-21",
};
`;

function styleCode(body: string): string {
  return `${INFO}\n${body}`;
}

function makeContexts(): CitationContext[] {
  return [
    {
      id: "ctx-1",
      page: 1,
      cites: [
        {
          item: {
            id: "1",
            itemType: "book",
            title: "A title",
            creators: [],
            extra: {},
          } as never,
          params: {},
        },
      ],
      params: {},
    },
  ];
}

function firstContent(result: StyleResult): {
  text: string;
  marks: readonly Record<string, unknown>[];
} {
  const citation = result.citations[0] as
    | { content: { text: string; marks: readonly Record<string, unknown>[] } }
    | undefined;
  assert.isDefined(citation);
  return citation!.content;
}

async function rejectionOf(
  run: () => Promise<unknown>,
): Promise<Error & { code?: string }> {
  try {
    await run();
  } catch (error) {
    return error as Error & { code?: string };
  }
  throw new Error("expected the operation to reject");
}

describe("Gecko host adapter", function () {
  this.timeout(15000);

  it("loads, clones metadata and generates through the plugin host", async function () {
    const style = await createStyle(
      styleCode(`
        const STYLE_OPTIONS = [
          { id: "mode", kind: "value", label: "Mode", defaultValue: "x" },
        ];
        function generate() {
          return {
            citations: [
              { id: contexts[0].id, content: text("ok:" + options.mode) },
            ],
            bibliography: [],
          };
        }
      `),
    );

    assert.strictEqual(Object.getPrototypeOf(style.INFO), Object.prototype);
    assert.strictEqual(
      Object.getPrototypeOf(style.STYLE_OPTIONS?.[0]),
      Object.prototype,
    );

    const result = await style.generate(makeContexts(), { mode: "auto" });
    assert.equal(firstContent(result).text, "ok:auto");
  });

  it("keeps host globals out of the sandbox and blocks network", async function () {
    const style = await createStyle(
      styleCode(`
        function generate() {
          const types = [
            typeof Zotero,
            typeof Components,
            typeof Services,
            typeof IOUtils,
            typeof PathUtils,
            typeof document,
            typeof window,
            typeof fetch,
          ].join(",");
          let blocked = false;
          try {
            fetch("https://example.org");
          } catch {
            blocked = true;
          }
          return {
            citations: [
              { id: contexts[0].id, content: types + "|" + String(blocked) },
            ],
            bibliography: [],
          };
        }
      `),
    );

    assert.equal(
      firstContent(await style.generate(makeContexts())).text,
      "undefined,undefined,undefined,undefined,undefined,undefined,undefined,function|true",
    );
  });

  it("exposes contexts as a readonly, undefined-free view", async function () {
    const style = await createStyle(
      styleCode(`
        function generate() {
          const item = contexts[0].cites[0].item;
          const missing = item.notAField;
          let assignmentRefused = false;
          try {
            contexts[0].id = "changed";
          } catch {
            assignmentRefused = true;
          }
          let deleteRefused = false;
          try {
            delete contexts[0].page;
          } catch {
            deleteRefused = true;
          }
          let optionsRefused = false;
          try {
            options.anything = "x";
          } catch {
            optionsRefused = true;
          }
          return {
            citations: [
              {
                id: contexts[0].id,
                content: [
                  missing === "" ? "empty" : "value",
                  String(assignmentRefused),
                  String(deleteRefused),
                  String(optionsRefused),
                  contexts[0].id,
                ].join("|"),
              },
            ],
            bibliography: [],
          };
        }
      `),
    );

    assert.equal(
      firstContent(await style.generate(makeContexts())).text,
      "empty|true|true|true|ctx-1",
    );
  });

  it("refuses to let a style replace a sandbox utility", async function () {
    for (const utility of ["readText", "htmlToUnit"]) {
      const error = await rejectionOf(() =>
        createStyle(
          styleCode(`
            ${utility} = () => "overwritten";
            function generate() {
              return { citations: [], bibliography: [] };
            }
          `),
        ),
      );

      assert.equal(error.code, "style-load", `${utility} must stay final`);
    }
  });

  it("keeps the core console after a replacement attempt", async function () {
    const style = await createStyle(
      styleCode(`
        try {
          console = { warn: () => {} };
        } catch {
          // A refused replacement is fine; the following call must still
          // reach the console the core installed.
        }
        function generate() {
          console.warn("still the core console");
          return {
            citations: [{ id: contexts[0].id, content: "ok" }],
            bibliography: [],
          };
        }
      `),
    );

    await style.generate(makeContexts());

    assert.deepEqual(
      style.diagnostics.map((message) => message.message),
      ["still the core console"],
    );
  });

  it("parses markup through the Zotero parseHtml capability", async function () {
    const style = await createStyle(
      styleCode(`
        function generate() {
          return {
            citations: [
              { id: contexts[0].id, content: "H<sub>2</sub>O and <b>bold</b>" },
            ],
            bibliography: [],
          };
        }
      `),
    );

    const content = firstContent(await style.generate(makeContexts()));
    assert.equal(content.text, "H2O and bold");
    assert.deepEqual(content.marks, [
      { type: "script", start: 1, end: 2, value: "subscript" },
      { type: "bold", start: 8, end: 12, value: true },
    ]);
  });

  it("reports a missing parseHtml capability instead of leaving markup", async function () {
    const originalCapabilities = zoteroStyleHost.capabilities;
    try {
      // Leave readFile and resolveMultilingualItems out too: the missing
      // capability must surface at the point of use, not from assertReady.
      zoteroStyleHost.capabilities = {
        readFile: zoteroCapabilities.readFile,
        resolveMultilingualItems: zoteroCapabilities.resolveMultilingualItems,
      };

      const style = await createStyle(
        styleCode(`
          function generate() {
            return {
              citations: [{ id: contexts[0].id, content: "<i>x</i>" }],
              bibliography: [],
            };
          }
        `),
      );

      const error = await rejectionOf(() => style.generate(makeContexts()));
      assert.equal(error.code, "host-capability");
      assert.match(error.message, /parseHtml/);
    } finally {
      zoteroStyleHost.capabilities = originalCapabilities;
    }
  });

  it("rejects paths outside the banyan data directory", async function () {
    const error = await rejectionOf(() =>
      zoteroCapabilities.readFile("../outside"),
    );

    assert.match(
      error.message,
      /Only files in banyan data directory are allowed/,
    );
  });

  it("reports a non-Banyan item to the multilingual capability", async function () {
    const error = await rejectionOf(() =>
      zoteroCapabilities.resolveMultilingualItems({
        id: "1",
      } as unknown as ScriptItem),
    );

    assert.instanceOf(error, TypeError);
    assert.match(error.message, /Banyan item/);
  });

  it("resolves parameter validation and list default provenance", async function () {
    const style = await createStyle(
      styleCode(`
        const STYLE_OPTIONS = [
          {
            id: "prefix",
            kind: "value",
            label: "Prefix",
            defaultValue: "",
            validate: (value) => (value.includes("<") ? "no markup" : true),
          },
        ];
        const CITE_PARAMS = [
          {
            id: "pages",
            kind: "list",
            label: "Pages",
            fields: [
              {
                id: "page",
                kind: "value",
                label: "Page",
                defaultValue: "1",
                validate: (value) =>
                  value === "1" ? "missing page" : true,
              },
            ],
          },
        ];
        function generate() {
          return { citations: [], bibliography: [] };
        }
      `),
    );

    const optionState = resolveStyleOptionState(style.STYLE_OPTIONS, {
      prefix: "<b>x",
    });
    assert.isFalse(optionState.states.prefix?.validation?.valid);
    assert.match(
      optionState.states.prefix?.validation?.message ?? "",
      /no markup/,
    );

    const cite: Cite = {
      item: {
        id: "1",
        itemType: "book",
        title: "A title",
      } as never,
      params: { pages: [{}] },
    };
    const citation: CitationContext = {
      id: "ctx-1",
      page: 1,
      cites: [cite],
      params: {},
    };
    const citeState = resolveCiteParamValues(
      style.CITE_PARAMS,
      cite,
      citation,
      {},
      { validate: true },
    );

    const cell = citeState.states.pages?.fieldValidation?.page?.[0];
    assert.equal(cell?.source, "default");
    assert.isFalse(cell?.valid);
    assert.match(cell?.message ?? "", /missing page/);
  });

  it("times out a stuck generate and serves the next run", async function () {
    const style = await createStyle(
      styleCode(`
        let first = true;
        function generate() {
          if (first) {
            first = false;
            return new Promise(() => {});
          }
          return {
            citations: [{ id: contexts[0].id, content: "after timeout" }],
            bibliography: [],
          };
        }
      `),
      { generateTimeoutMs: 20 },
    );

    const error = await rejectionOf(() => style.generate(makeContexts()));
    assert.equal(error.code, "generate-timeout");

    const result = await style.generate(makeContexts());
    assert.equal(firstContent(result).text, "after timeout");
  });

  it("keeps findings per run and never stores trace lines", async function () {
    const style = await createStyle(
      styleCode(`
        const STYLE_OPTIONS = [
          {
            id: "mode",
            kind: "value",
            label: "Mode",
            defaultValue: "x",
            forcedValue: () => {
              console.warn("resolving option");
              return null;
            },
          },
        ];
        function generate() {
          console.log("trace line");
          console.info("info line");
          console.warn("warn line");
          console.error("error line");
          return {
            citations: [{ id: contexts[0].id, content: "ok" }],
            bibliography: [],
          };
        }
      `),
    );

    await style.generate(makeContexts());
    await style.generate(makeContexts());

    assert.deepEqual(
      style.diagnostics.map((message) => [message.code, message.message]),
      [
        ["generate", "resolving option"],
        ["generate", "info line"],
        ["generate", "warn line"],
        ["generate", "error line"],
      ],
    );
    assert.isFalse(
      style.diagnostics.some((message) => message.message === "trace line"),
    );
  });

  it("bridges file bytes as realm-native typed arrays", async function () {
    const dirPath = await ensureDataDir();
    const filePath = PathUtils.join(dirPath, "__host-contract__.bin");
    await IOUtils.write(filePath, new Uint8Array([65, 66, 67]));

    try {
      const style = await createStyle(
        styleCode(`
          async function generate() {
            const data = await readBytes("__host-contract__.bin");
            const view = new DataView(data.buffer);
            return {
              citations: [
                {
                  id: contexts[0].id,
                  content: [
                    data instanceof Uint8Array ? "Uint8Array" : typeof data,
                    String(data),
                    data.length,
                    view instanceof DataView ? "DataView" : typeof view,
                  ].join("|"),
                },
              ],
              bibliography: [],
            };
          }
        `),
      );

      assert.equal(
        firstContent(await style.generate(makeContexts())).text,
        "Uint8Array|65,66,67|3|DataView",
      );
    } finally {
      await IOUtils.remove(filePath, { ignoreAbsent: true });
    }
  });

  it("reports malformed contexts as generate-input", async function () {
    const style = await createStyle(
      styleCode(`
        function generate() {
          return { citations: [], bibliography: [] };
        }
      `),
    );

    const error = await rejectionOf(() => style.generate({} as never));
    assert.equal(error.code, "generate-input");
  });
});
