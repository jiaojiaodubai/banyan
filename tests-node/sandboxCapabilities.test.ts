import { assert } from "chai";

/**
 * The host side of `parseHtml`: the core asks the host to parse markup, so the
 * parser chain (ambient `DOMParser`, then the main window through `ztoolkit`)
 * and the failure mode belong to the plugin. Markup splitting itself is core
 * behaviour.
 */

const globals = globalThis as Record<string, unknown>;
const ROOT_ID = "__banyan_html_root__";

/** Minimal parser: the capability only reads the fragment root back. */
function fakeParser(seen: { html?: string }) {
  return class {
    parseFromString(html: string) {
      seen.html = html;
      return {
        getElementById: (id: string) =>
          id === ROOT_ID ? { nodeType: 1 } : null,
      };
    }
  };
}

function captureError(run: () => unknown): {
  message: string;
  code?: unknown;
} {
  try {
    run();
  } catch (error) {
    return error as { message: string; code?: unknown };
  }
  throw new Error("expected the call to throw");
}

describe("host capability: parseHtml", function () {
  type Capabilities = typeof import("../src/modules/sandbox/capabilities");

  let capabilities: Capabilities;
  let originalDomParser: unknown;
  let originalZtoolkit: unknown;

  before(async function () {
    originalDomParser = globals.DOMParser;
    originalZtoolkit = globals.ztoolkit;
    globals.ztoolkit = { log: () => {}, logError: () => {} };
    capabilities = await import("../src/modules/sandbox/capabilities");
  });

  after(function () {
    globals.DOMParser = originalDomParser;
    globals.ztoolkit = originalZtoolkit;
  });

  it("prefers the ambient parser", function () {
    const seen: { html?: string } = {};
    globals.DOMParser = fakeParser(seen);
    globals.ztoolkit = {
      getGlobal: () => {
        throw new Error("the ambient parser must win");
      },
    };

    const root = capabilities.zoteroCapabilities.parseHtml("<b>x</b>");

    assert.isNotNull(root);
    assert.include(String(seen.html), "<b>x</b>");
  });

  it("falls back to the main window parser through ztoolkit", function () {
    delete globals.DOMParser;
    const seen: { html?: string } = {};
    let requested: string | undefined;
    globals.ztoolkit = {
      getGlobal(name: string) {
        requested = name;
        return fakeParser(seen);
      },
    };

    const root = capabilities.zoteroCapabilities.parseHtml("<i>y</i>");

    assert.isNotNull(root);
    assert.equal(requested, "DOMParser");
    assert.include(String(seen.html), "<i>y</i>");
  });

  it("reports a host error when no parser is reachable", function () {
    delete globals.DOMParser;
    globals.ztoolkit = { getGlobal: () => undefined };

    const error = captureError(() =>
      capabilities.zoteroCapabilities.parseHtml("<b>x</b>"),
    );

    assert.match(error.message, /DOMParser is unavailable/);
    assert.equal(error.code, "host-capability");
  });

  it("reports a host error when the parsed document has no fragment root", function () {
    delete globals.DOMParser;
    globals.ztoolkit = {
      getGlobal: () =>
        class {
          parseFromString() {
            return { getElementById: () => null };
          }
        },
    };

    const error = captureError(() =>
      capabilities.zoteroCapabilities.parseHtml("<b>x</b>"),
    );

    assert.match(error.message, /no fragment root/);
    assert.equal(error.code, "host-capability");
  });

  it("routes a run's messages into the plugin logger by severity", async function () {
    const debugLines: unknown[][] = [];
    const consoleLines: unknown[][] = [];
    globals.ztoolkit = {
      log: (...args: unknown[]) => debugLines.push(args),
    };
    const originalZotero = globals.Zotero;
    globals.Zotero = {
      debug: () => {},
      log: (...args: unknown[]) => consoleLines.push(args),
    };

    try {
      const sandbox = await import("../src/modules/sandbox");
      sandbox.logStyleMessage({
        severity: "trace",
        source: "style",
        code: "generate",
        message: "step 1",
      });
      sandbox.logStyleMessage({
        severity: "warning",
        source: "field-presets",
        code: "style-load",
        message: "ignored key",
      });
      sandbox.logStyleMessage(
        {
          severity: "warning",
          source: "field-presets",
          code: "style-load",
          message: "ignored key",
        },
        "test-style / Test Style",
      );
      sandbox.logStyleMessage({
        severity: "warning",
        source: "params",
        code: "style-load",
        message: "'mode': validate is not available on state parameters",
        detail: {
          style: { id: "test-style", title: "Test Style" },
          declaration: { export: "STYLE_OPTIONS", id: "mode", index: 0 },
        },
      });
    } finally {
      globals.Zotero = originalZotero;
    }

    assert.deepEqual(debugLines, [["[sandbox] style (generate): step 1"]]);
    assert.deepEqual(consoleLines, [
      ["[sandbox] field-presets (style-load): ignored key", "warning"],
      [
        "[sandbox] [style=test-style / Test Style] field-presets (style-load): ignored key",
        "warning",
      ],
      [
        "[sandbox] [style=test-style / Test Style] [STYLE_OPTIONS[0] 'mode'] params (style-load): 'mode': validate is not available on state parameters",
        "warning",
      ],
    ]);
  });

  it("formats declaration locations from the core's detail", async function () {
    const sandbox = await import("../src/modules/sandbox");

    assert.equal(sandbox.formatStyleMessageLocation(undefined), "");
    assert.equal(
      sandbox.formatStyleMessageLocation({
        declaration: { export: "STYLE_OPTIONS", id: "mode", index: 0 },
      }),
      "STYLE_OPTIONS[0] 'mode'",
    );
    assert.equal(
      sandbox.formatStyleMessageLocation({
        declaration: { export: "STYLE_OPTIONS", index: 3 },
      }),
      "STYLE_OPTIONS[3]",
    );
    assert.equal(
      sandbox.formatStyleMessageLocation({
        declaration: {
          export: "CITE_PARAMS",
          id: "pages",
          index: 1,
          field: "start",
          fieldIndex: 0,
        },
      }),
      "CITE_PARAMS[1] 'pages'.fields[0] 'start'",
    );
    assert.equal(
      sandbox.formatStyleMessageLocation({
        declaration: { export: "ITEM_FIELD_VALIDATORS", group: "book" },
      }),
      "ITEM_FIELD_VALIDATORS 'book'",
    );
  });
});
