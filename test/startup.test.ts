import { assert } from "chai";
import { config } from "../package.json";

describe("startup", function () {
  it("should have plugin instance defined", function () {
    assert.isNotEmpty(
      (Zotero as Record<string, unknown>)[config.addonInstance],
    );
  });

  it("should complete development startup without failures", function () {
    const plugin = (Zotero as Record<string, unknown>)[
      config.addonInstance
    ] as typeof addon;
    assert.isTrue(plugin.data.initialized);
    assert.strictEqual(plugin.data.env, "development");
    assert.deepEqual(plugin.data.startupFailures, []);
  });
});
