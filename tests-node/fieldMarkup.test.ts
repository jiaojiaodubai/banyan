import { assert } from "chai";
import {
  clearFieldMarks,
  countFieldMarks,
  getActiveMarks,
  parseFieldMarkup,
  serializeFieldMarkup,
  toggleFieldMark,
} from "../src/utils/fieldMarkup";

describe("field markup", function () {
  it("parses canonical tags and HTML synonyms", function () {
    const parsed = parseFieldMarkup(
      "<b>bold</b> <strong>also bold</strong> <i>it</i> <em>also it</em>",
    );
    assert.isUndefined(parsed.error);
    assert.equal(parsed.visibleText, "bold also bold it also it");
    assert.deepEqual(
      parsed.runs.map((run) => run.text),
      ["bold", " ", "also bold", " ", "it", " ", "also it"],
    );
    assert.deepEqual(
      parsed.runs.map((run) => run.marks),
      [["bold"], [], ["bold"], [], ["italic"], [], ["italic"]],
    );
  });

  it("parses nocase and small-caps spans, not sc/nc", function () {
    const parsed = parseFieldMarkup(
      '<span class="nocase">DNA</span><span style="font-variant:small-caps;">RNA</span>',
    );
    assert.isUndefined(parsed.error);
    assert.deepEqual(
      parsed.runs.map((run) => run.marks),
      [["noCase"], ["smallCaps"]],
    );
    assert.equal(parseFieldMarkup("<sc>DNA</sc>").error?.kind, "unsupported");
    assert.equal(parseFieldMarkup("<nc>DNA</nc>").error?.kind, "unsupported");
  });

  it("rejects crossing, unbalanced and unknown paired tags", function () {
    assert.equal(parseFieldMarkup("<b>a<i>b</b>c</i>").error?.kind, "crossing");
    assert.equal(parseFieldMarkup("<b>a").error?.kind, "unbalanced");
    assert.equal(
      parseFieldMarkup("<a href='x'>a</a>").error?.kind,
      "unsupported",
    );
  });

  it("keeps bare comparison text", function () {
    const parsed = parseFieldMarkup("1 < 2 and 3 > 2");
    assert.isUndefined(parsed.error);
    assert.equal(parsed.visibleText, "1 < 2 and 3 > 2");
  });

  it("serializes canonically and round-trips", function () {
    const parsed = parseFieldMarkup(
      '<span style="font-variant:small-caps;">A</span><b><i>B</i></b>',
    );
    const serialized = serializeFieldMarkup(parsed.runs);
    assert.equal(
      serialized,
      '<span style="font-variant:small-caps;">A</span><b><i>B</i></b>',
    );
    assert.equal(parseFieldMarkup(serialized).visibleText, "AB");
  });

  it("toggles whole and partial ranges", function () {
    const parsed = parseFieldMarkup("abcdef");
    const bold = toggleFieldMark(parsed.runs, [1, 3], "bold");
    assert.equal(serializeFieldMarkup(bold), "a<b>bc</b>def");
    const off = toggleFieldMark(bold, [1, 3], "bold");
    assert.equal(serializeFieldMarkup(off), "abcdef");
    const partial = toggleFieldMark(bold, [2, 4], "bold");
    assert.equal(serializeFieldMarkup(partial), "a<b>bcd</b>ef");
  });

  it("keeps superscript and subscript exclusive", function () {
    const runs = parseFieldMarkup("x").runs;
    const sup = toggleFieldMark(runs, [0, 1], "superscript");
    const sub = toggleFieldMark(sup, [0, 1], "subscript");
    assert.deepEqual(sub[0].marks, ["subscript"]);
  });

  it("clears marks and reports active/count", function () {
    const parsed = parseFieldMarkup("<b>a</b><i>b</i>");
    assert.deepEqual([...getActiveMarks(parsed.runs, [0, 2])], []);
    assert.deepInclude(countFieldMarks(parsed.runs), { bold: 1, italic: 1 });
    const cleared = clearFieldMarks(parsed.runs, [0, 2]);
    assert.equal(serializeFieldMarkup(cleared), "ab");
  });
});
