import { assert } from "chai";
import { extractFieldCheckTargets } from "../src/utils/fieldCheckTargets";

describe("field check target extraction", function () {
  it("reads the localized label and the field name", function () {
    assert.deepEqual(
      extractFieldCheckTargets("会议论文缺会址：请填「地点」（place）。"),
      ["地点", "place"],
    );
  });

  it("splits alternative labels and keys", function () {
    assert.includeMembers(
      extractFieldCheckTargets(
        "报纸论文缺版次或页码：请填「版/版次」（edition）/「版」（section）/「页码」（pages）之一。",
      ),
      ["版/版次", "版次", "edition", "section", "页码", "pages"],
    );
  });

  it("reads extra keys written in backticks", function () {
    assert.includeMembers(
      extractFieldCheckTargets(
        "期刊论文缺页码：请填「页码」（pages）；只有文章编号时请在「其他」写 `article-number: 12345`。",
      ),
      ["其他", "article-number", "12345"],
    );
  });

  it("ignores prose without a field mention", function () {
    assert.deepEqual(extractFieldCheckTargets("会议论文缺会议信息。"), []);
  });
});
