import { assert } from "chai";
import { config } from "../package.json";

/**
 * The style index in `addon.data` is shared by every window bundle. Executable
 * style declarations (`visible`, `check`) belong to the main-window bundle and
 * must never leak into it: a dialog that indexes styles would otherwise hand
 * the main window closures whose realm can be gone by the time they run.
 */
describe("style index isolation", function () {
  const plugin = () =>
    (Zotero as Record<string, unknown>)[config.addonInstance] as typeof addon;

  function assertSerializable(
    value: unknown,
    path: string,
    seen = new Set<unknown>(),
  ): void {
    if (value === null || typeof value !== "object") {
      assert.notEqual(
        typeof value,
        "function",
        `${path} holds a function in the shared style index`,
      );
      return;
    }
    if (seen.has(value)) return;
    seen.add(value);

    if (value instanceof Map) {
      for (const [key, entry] of value) {
        assertSerializable(key, `${path}<key>`, seen);
        assertSerializable(entry, `${path}.get(${String(key)})`, seen);
      }
      return;
    }
    if (value instanceof Set) {
      let index = 0;
      for (const entry of value) {
        assertSerializable(entry, `${path}[${index++}]`, seen);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) =>
        assertSerializable(entry, `${path}[${index}]`, seen),
      );
      return;
    }
    // Window, Document, sandbox wrappers: a shared index must not point at
    // them either, even when they are not functions.
    const name = Object.prototype.toString.call(value);
    assert.isFalse(
      name === "[object Window]" || name === "[object Document]",
      `${path} references a host window/document`,
    );
    for (const [key, entry] of Object.entries(value)) {
      assertSerializable(entry, `${path}.${key}`, seen);
    }
  }

  it("keeps the shared style index serializable", function () {
    assertSerializable(plugin().data.styles, "addon.data.styles");
  });

  it("records declarations as flags and item types, not executable entries", function () {
    const styles = plugin().data.styles.files;
    assert.isAbove(styles.size, 0, "the startup index should contain styles");
    for (const entry of styles.values()) {
      if (entry.hasFieldPresets !== undefined) {
        assert.isBoolean(entry.hasFieldPresets);
      }
      if (entry.itemFieldValidatorTypes !== undefined) {
        assert.isArray(entry.itemFieldValidatorTypes);
        for (const itemType of entry.itemFieldValidatorTypes) {
          assert.isString(itemType);
        }
      }
    }
  });

  it("remains rebuildable through the main-window API", async function () {
    const api = plugin().api;
    assert.isFunction(api.reloadStyles);
    assert.isFunction(api.runItemFieldChecks);
    await api.reloadStyles();
    assert.isAbove(plugin().data.styles.files.size, 0);
    assertSerializable(plugin().data.styles, "addon.data.styles");
  });
});
