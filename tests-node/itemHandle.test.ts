import { assert } from "chai";
import { decodeZoteroItemId } from "../src/utils/itemHandle";

describe("opaque item handle decoding", function () {
  it("decodes a positive safe-integer handle", function () {
    assert.equal(decodeZoteroItemId("51"), 51);
    assert.equal(decodeZoteroItemId(51), 51);
  });

  it("rejects a handle that is not a positive safe integer", function () {
    assert.isUndefined(decodeZoteroItemId("0"));
    assert.isUndefined(decodeZoteroItemId(0));
    assert.isUndefined(decodeZoteroItemId("-3"));
    assert.isUndefined(decodeZoteroItemId("2.5"));
    assert.isUndefined(decodeZoteroItemId("abc"));
    assert.isUndefined(decodeZoteroItemId(""));
    assert.isUndefined(decodeZoteroItemId(undefined));
    assert.isUndefined(decodeZoteroItemId(null));
    assert.isUndefined(decodeZoteroItemId(true));
    assert.isUndefined(decodeZoteroItemId(Number.MAX_SAFE_INTEGER + 1));
  });
});
