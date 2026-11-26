import { assert } from "chai";
import {
  isEditableExtraPair,
  parseExtraPairs,
  replaceExtraPairValue,
} from "../src/utils/extraFieldLines";

describe("extra field line model", function () {
  it("finds modern pairs and skips legacy/prose", function () {
    const extra = [
      "Status: advance online publication",
      "prose without a key",
      "{:author: Smith}",
      "Volume: 12",
    ].join("\n");
    const pairs = parseExtraPairs(extra);
    assert.deepEqual(
      pairs.map((pair) => [pair.lineIndex, pair.keyRaw, pair.value]),
      [
        [0, "Status", "advance online publication"],
        [3, "Volume", "12"],
      ],
    );
  });

  it("replaces only the target value and preserves the rest", function () {
    const extra = "Status: old\r\nGenre: article\r\n";
    const pair = parseExtraPairs(extra)[0];
    const next = replaceExtraPairValue(extra, pair, "<i>new</i>");
    assert.equal(next, "Status: <i>new</i>\r\nGenre: article\r\n");
  });

  it("denies CSL switch/identifier keys but allows string variables", function () {
    const pairs = parseExtraPairs(
      "type: classic\nlanguage: en\nstatus: published\nGenre: article\nPublisher: Press\nDOI: 10/x",
    );
    assert.deepEqual(
      pairs.map((pair) => isEditableExtraPair(pair)),
      [false, false, true, true, true, false],
    );
  });

  it("allows text-capable edition/volume/version keys", function () {
    const pairs = parseExtraPairs(
      "Edition: Special edition\nVolume: 2: Organizational Psychology\nversion: 1.0",
    );
    assert.deepEqual(
      pairs.map((pair) => isEditableExtraPair(pair)),
      [true, true, true],
    );
  });

  it("keeps the creator extension block out of the editable pairs", function () {
    const pair = parseExtraPairs(
      'creators-ext: {"creatorType":"author","lastName":"Ada"}',
    )[0];
    assert.isFalse(isEditableExtraPair(pair));
  });
});
