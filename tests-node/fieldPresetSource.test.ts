import { assert } from "chai";
import {
  FIELD_PRESET_DISABLED,
  getPresetSourceSelection,
} from "../src/modules/itemFieldPresets";

describe("quick marks menu source", function () {
  // A style that is not in the list only changes what the list shows: the stored
  // value is left alone, and the item menu falls back on its own.
  it("falls back to 'Last used' for a style that is not listed", function () {
    assert.equal(getPresetSourceSelection("my-style", []), "");
    assert.equal(getPresetSourceSelection("my-style", ["other"]), "");
    assert.equal(
      getPresetSourceSelection("my-style", ["other", "my-style"]),
      "my-style",
    );
  });

  it("keeps the fixed options selectable", function () {
    assert.equal(getPresetSourceSelection("", ["my-style"]), "");
    assert.equal(
      getPresetSourceSelection(FIELD_PRESET_DISABLED, []),
      FIELD_PRESET_DISABLED,
    );
    assert.equal(
      getPresetSourceSelection(FIELD_PRESET_DISABLED, ["my-style"]),
      FIELD_PRESET_DISABLED,
    );
  });
});
