import { assert } from "chai";
import { compile, plainText, unitUtils } from "../src/modules/unit";

const { affix, fallback, group, text, textCase, when, withStyle } = unitUtils;

describe("unit helpers", function () {
  it("combines visible units with delimiters while skipping empty candidates", function () {
    assert.deepEqual(
      compile(group(["Smith", "", text("2024", { bold: true })], ", ")),
      [{ value: "Smith" }, { value: ", " }, { value: "2024", bold: true }],
    );
  });

  it("adds affixes only when the main unit has visible text", function () {
    assert.deepEqual(compile(affix("2024", "(", ")")), [
      { value: "(" },
      { value: "2024" },
      { value: ")" },
    ]);
    assert.deepEqual(compile(affix("", "(", ")")), []);
  });

  it("uses fallback and when to choose the first visible branch", function () {
    assert.deepEqual(compile(fallback(["", text("Untitled"), "Ignored"])), [
      { value: "Untitled" },
    ]);
    assert.deepEqual(compile(when(false, "Shown", "Hidden")), [
      { value: "Hidden" },
    ]);
    assert.deepEqual(compile(when(false, "Shown")), []);
  });

  it("applies style over nested unit output without losing existing style", function () {
    assert.deepEqual(
      compile(
        withStyle(group([text("A", { italic: true }), "B"]), {
          bold: true,
          link: "https://example.test/ref",
        }),
      ),
      [
        {
          value: "A",
          italic: true,
          bold: true,
          link: "https://example.test/ref",
        },
        { value: "B", bold: true, link: "https://example.test/ref" },
      ],
    );
  });

  it("keeps plainText useful for sorting keys across declarative units", function () {
    assert.equal(
      plainText(group(["Smith", affix("2024", " (", ")")], "")),
      "Smith (2024)",
    );
  });

  it("demonstrates why Unit arrays must not be joined by script authors", function () {
    const parts = [affix("A", "", "."), affix("B", "", ".")];

    assert.equal(parts.join(" "), "[object Object] [object Object]");
    assert.equal(plainText(group(parts, " ")), "A. B.");
  });

  it("supports deterministic case transforms that do not require Zotero utilities", function () {
    assert.deepEqual(compile(textCase("Mixed Case", "lower")), [
      { value: "mixed case" },
    ]);
    assert.deepEqual(compile(textCase("Mixed Case", "upper")), [
      { value: "MIXED CASE" },
    ]);
  });
});
