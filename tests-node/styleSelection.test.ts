import { assert } from "chai";
import { pickDefaultStyleId } from "../src/modules/styleSelection";

describe("style chooser default selection", function () {
  it("prefers the caller's explicit style", function () {
    assert.equal(pickDefaultStyleId(["a", "b", "c"], "b", "c"), "b");
  });

  it("falls back to the item-menu/last-used style", function () {
    assert.equal(pickDefaultStyleId(["a", "b", "c"], undefined, "c"), "c");
    assert.equal(pickDefaultStyleId(["a", "b", "c"], "missing", "b"), "b");
  });

  it("falls back to the first style when neither id exists", function () {
    assert.equal(pickDefaultStyleId(["a", "b"], "missing", "gone"), "a");
    assert.isNull(pickDefaultStyleId([]));
  });
});
