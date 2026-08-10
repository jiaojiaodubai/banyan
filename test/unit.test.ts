import { assert } from "chai";
import { compile, plainText, unitUtils } from "../src/modules/unit";

const { affix, fallback, group, link, text, textCase, when, withStyle } =
  unitUtils;

describe("unit helpers", function () {
  it("combines visible units with delimiters while skipping empty candidates", function () {
    assert.deepEqual(
      compile(group(["Smith", "", text("2024", { bold: true })], ", ")),
      {
        text: "Smith, 2024",
        marks: [{ type: "bold", start: 7, end: 11, value: true }],
      },
    );
  });

  it("adds affixes only when the main unit has visible text", function () {
    assert.deepEqual(compile(affix("2024", "(", ")")), {
      text: "(2024)",
      marks: [],
    });
    assert.deepEqual(compile(affix("", "(", ")")), { text: "", marks: [] });
    assert.deepEqual(compile(affix(text(""), "(", ")")), {
      text: "",
      marks: [],
    });
  });

  it("uses fallback and when to choose the first visible branch", function () {
    assert.deepEqual(compile(fallback(["", text("Untitled"), "Ignored"])), {
      text: "Untitled",
      marks: [],
    });
    assert.deepEqual(compile(when(false, "Shown", "Hidden")), {
      text: "Hidden",
      marks: [],
    });
    assert.deepEqual(compile(when(false, "Shown")), { text: "", marks: [] });
  });

  it("applies style and link marks over nested unit output", function () {
    assert.deepEqual(
      compile(
        link(
          withStyle(group([text("A", { italic: true }), "B"]), {
            bold: true,
          }),
          "https://example.test/ref",
        ),
      ),
      {
        text: "AB",
        marks: [
          { type: "italic", start: 0, end: 1, value: true },
          { type: "bold", start: 0, end: 2, value: true },
          {
            type: "link",
            start: 0,
            end: 2,
            value: "https://example.test/ref",
          },
        ],
      },
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
    assert.deepEqual(compile(textCase("Mixed Case", "lower")), {
      text: "mixed case",
      marks: [],
    });
    assert.deepEqual(compile(textCase("Mixed Case", "upper")), {
      text: "MIXED CASE",
      marks: [],
    });
  });
});
