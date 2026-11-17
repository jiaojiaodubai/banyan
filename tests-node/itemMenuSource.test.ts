import { assert } from "chai";
import {
  ITEM_MENU_DISABLED,
  getItemMenuSourceSelection,
} from "../src/modules/itemMenu";

describe("item menu style source", function () {
  // A style that is not in the list only changes what the list shows: the stored
  // value is left alone, and the item menu falls back on its own.
  it("falls back to 'Last used' for a style that is not listed", function () {
    assert.equal(getItemMenuSourceSelection("my-style", []), "");
    assert.equal(getItemMenuSourceSelection("my-style", ["other"]), "");
    assert.equal(
      getItemMenuSourceSelection("my-style", ["other", "my-style"]),
      "my-style",
    );
  });

  it("keeps the fixed options selectable", function () {
    assert.equal(getItemMenuSourceSelection("", ["my-style"]), "");
    assert.equal(
      getItemMenuSourceSelection(ITEM_MENU_DISABLED, []),
      ITEM_MENU_DISABLED,
    );
    assert.equal(
      getItemMenuSourceSelection(ITEM_MENU_DISABLED, ["my-style"]),
      ITEM_MENU_DISABLED,
    );
  });
});
