import { assert } from "chai";
import { getStyleFaultCode } from "../src/modules/sandbox/faults";

/**
 * Which failures the front-end may report as a bad request. The decision reads
 * only the core's run code, so a message edit cannot move a case between 400
 * and 500.
 */
describe("style fault classification", function () {
  function errorWithCode(code: unknown): Error {
    return Object.assign(new Error("boom"), { code });
  }

  it("treats every style-side code as a style fault", function () {
    for (const code of [
      "style-load",
      "style-contract",
      "generate",
      "generate-output",
      "generate-timeout",
    ]) {
      assert.equal(getStyleFaultCode(errorWithCode(code)), code);
    }
  });

  it("keeps host and request problems out of the style's blame", function () {
    assert.isNull(getStyleFaultCode(errorWithCode("host-capability")));
    assert.isNull(getStyleFaultCode(errorWithCode("generate-input")));
  });

  it("ignores codes the core did not set", function () {
    assert.isNull(getStyleFaultCode(errorWithCode("ENOENT")));
    assert.isNull(getStyleFaultCode(errorWithCode(undefined)));
    assert.isNull(getStyleFaultCode(new Error("plain")));
    assert.isNull(getStyleFaultCode("thrown string"));
    assert.isNull(getStyleFaultCode(null));
  });
});
