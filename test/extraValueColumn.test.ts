import { assert } from "chai";
import { refreshExtraValueColumn } from "../src/modules/extraValueColumn";
import { getPref, setPref } from "../src/utils/prefs";
import { config } from "../package.json";

type ItemTreeManager = typeof Zotero.ItemTreeManager;
type ColumnOptions = Parameters<ItemTreeManager["registerColumn"]>[0];

describe("extra value column registration", function () {
  const globals = globalThis as Record<string, unknown>;
  let previousAddon: unknown;
  let originalRegister: ItemTreeManager["registerColumn"];
  let originalUnregister: ItemTreeManager["unregisterColumn"];
  let registeredKey: string | null;
  let registrations: ColumnOptions[];
  let unregisterResults: boolean[];
  let previousPref: string;

  beforeEach(function () {
    const manager = Zotero.ItemTreeManager;
    // The test page does not define the plugin's `addon` global, which the
    // module reads for the plugin id.
    previousAddon = globals.addon;
    globals.addon = (Zotero as Record<string, unknown>)[config.addonInstance];
    previousPref = String(getPref("extraValueColumnKey") ?? "");

    originalRegister = manager.registerColumn;
    originalUnregister = manager.unregisterColumn;
    registeredKey = null;
    registrations = [];
    unregisterResults = [];
    // Stand-in for Zotero, which rejects a duplicate `dataKey` instead of
    // replacing it; the real registry is left untouched.
    manager.registerColumn = ((options: ColumnOptions) => {
      registrations.push(options);
      registeredKey = `test-key:${options.dataKey}`;
      return registeredKey;
    }) as ItemTreeManager["registerColumn"];
    manager.unregisterColumn = ((key: string) => {
      const removed = registeredKey === key;
      if (removed) {
        registeredKey = null;
      }
      unregisterResults.push(removed);
      return removed;
    }) as ItemTreeManager["unregisterColumn"];
  });

  afterEach(function () {
    const manager = Zotero.ItemTreeManager;
    manager.registerColumn = originalRegister;
    manager.unregisterColumn = originalUnregister;
    setPref("extraValueColumnKey", previousPref);
    globals.addon = previousAddon;
  });

  it("registers, re-registers and drops the column with the configured key", function () {
    setPref("extraValueColumnKey", "");
    refreshExtraValueColumn();
    assert.isEmpty(registrations, "no key must mean no column");

    setPref("extraValueColumnKey", "Type");
    refreshExtraValueColumn();
    assert.lengthOf(registrations, 1);
    assert.equal(registrations[0].dataKey, "extraValue");
    assert.include(String(registrations[0].label), "Type");

    // Rebuilding must not be rejected as a duplicate registration.
    setPref("extraValueColumnKey", "Citation Key");
    refreshExtraValueColumn();
    assert.lengthOf(registrations, 2);
    assert.include(String(registrations[1].label), "Citation Key");
    assert.isTrue(
      unregisterResults.every((removed) => removed),
      "each rebuild must unregister the previous column",
    );

    setPref("extraValueColumnKey", "");
    refreshExtraValueColumn();
    assert.lengthOf(registrations, 2, "clearing the key must not add a column");
    assert.isNull(registeredKey, "clearing the key must drop the column");
  });
});
