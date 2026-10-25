import { assert } from "chai";

/**
 * The host side of `resolveStyle`: an id means "which installed style is this",
 * so resolution reads the index and then the file the index names. The called
 * style's directory is the flat `banyan` directory, which is why the caller's
 * `readFile` is handed back unchanged instead of being re-derived per style.
 */

const globals = globalThis as Record<string, unknown>;

describe("host capability: resolveStyle", function () {
  type Capabilities = typeof import("../src/modules/sandbox/capabilities");

  let capabilities: Capabilities;
  let originalAddon: unknown;
  let originalPathUtils: unknown;
  let originalIOUtils: unknown;
  let originalZotero: unknown;
  let reads: string[];

  before(async function () {
    originalAddon = globals.addon;
    originalPathUtils = globals.PathUtils;
    originalIOUtils = globals.IOUtils;
    originalZotero = globals.Zotero;
    reads = [];
    globals.addon = {
      data: {
        styles: {
          files: new Map([
            ["other-style", { id: "other-style", filename: "other-style.js" }],
          ]),
        },
      },
    };
    globals.PathUtils = {
      join: (...parts: string[]) => parts.join("/"),
    };
    globals.IOUtils = {
      readUTF8: async (filePath: string) => {
        reads.push(filePath);
        return `code of ${filePath}`;
      },
    };
    globals.Zotero = { DataDirectory: { dir: "C:/Zotero" } };
    capabilities = await import("../src/modules/sandbox/capabilities");
  });

  after(function () {
    globals.addon = originalAddon;
    globals.PathUtils = originalPathUtils;
    globals.IOUtils = originalIOUtils;
    globals.Zotero = originalZotero;
  });

  it("resolves an indexed style to its code and the data-directory reader", async function () {
    const source =
      await capabilities.zoteroCapabilities.resolveStyle!("other-style");

    assert.equal(source?.code, "code of C:/Zotero/banyan/other-style.js");
    assert.deepEqual(reads, ["C:/Zotero/banyan/other-style.js"]);
    assert.equal(source?.readFile, capabilities.zoteroCapabilities.readFile);
  });

  it("returns null for an id that is not installed", async function () {
    reads = [];
    const source =
      await capabilities.zoteroCapabilities.resolveStyle!("missing-style");

    assert.isNull(source);
    assert.deepEqual(reads, []);
  });

  it("propagates a read failure so the core can report it", async function () {
    globals.IOUtils = {
      readUTF8: async () => {
        throw new Error("EACCES: cannot read the style");
      },
    };

    let error: unknown;
    try {
      await capabilities.zoteroCapabilities.resolveStyle!("other-style");
    } catch (caught) {
      error = caught;
    }

    assert.instanceOf(error, Error);
    assert.match((error as Error).message, /cannot read the style/);
  });
});
