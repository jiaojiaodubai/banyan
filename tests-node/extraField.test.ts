import { assert } from "chai";
import {
  analyzeExtraField,
  mergeExtraField,
  needsConflictDecision,
} from "../src/utils/extraField";
import {
  isValidExtraKey,
  parseExtraLine,
  parseExtraLines,
} from "../src/utils/item";

describe("extra field helpers", function () {
  describe("parseExtraLines", function () {
    it("tags key/value lines with their normalized key", function () {
      const parsed = parseExtraLines("Type: classic\nCitation Key: ab12");

      assert.deepEqual(parsed, [
        { raw: "Type: classic", normalizedKey: "type", value: "classic" },
        {
          raw: "Citation Key: ab12",
          normalizedKey: "citation-key",
          value: "ab12",
        },
      ]);
    });

    it("leaves prose and blank lines without a key", function () {
      const parsed = parseExtraLines("Reprinted from X\n\nno colon here");

      assert.deepEqual(
        parsed.map((line) => line.normalizedKey),
        [null, null, null],
      );
    });

    it("keeps prose with a colon outside the variable-line syntax", function () {
      const extra = [
        "10:30 meeting notes",
        "- see: appendix",
        "Status:",
        "Note: ",
        "{:not-closed: x",
      ].join("\n");

      assert.deepEqual(
        parseExtraLines(extra).map((line) => line.normalizedKey),
        [null, null, null, null, null],
      );
    });

    it("reads Zotero's charset, digits and non-Latin keys alike", function () {
      const parsed = parseExtraLines(
        "Original Date: 1865\n版本说明2: 影印本\nC3N4: x\noriginal-container-title: y",
      );

      assert.deepEqual(
        parsed.map((line) => line.normalizedKey),
        ["original-date", "版本说明2", "c3-n4", "original-container-title"],
      );
    });

    it("treats a dotted key as prose, like Zotero's own reader", function () {
      // The charset is Zotero's (`^([a-z][a-z -_]+):(.+)`): a key such as
      // `tex.shorttitle` is prose for Zotero, so it is not a key of
      // `item.extra` here either. A URL still parses — Zotero does the same.
      const parsed = parseExtraLines(
        "tex.shorttitle: Foo\nhttps://example.org/x",
      );

      assert.deepEqual(
        parsed.map((line) => line.normalizedKey),
        [null, "https"],
      );
    });

    it("recognizes the legacy citeproc cheater syntax", function () {
      const parsed = parseExtraLines("{:author: Smith, John}\nplain prose");

      assert.deepEqual(parsed[0], {
        raw: "{:author: Smith, John}",
        normalizedKey: "author",
        value: "Smith, John",
      });
      assert.isNull(parsed[1].normalizedKey);
    });
  });

  describe("analyzeExtraField", function () {
    it("collects every value of a repeated key in file order", function () {
      const extra = "author: A\nnote: n\nauthor: B";

      assert.deepEqual(analyzeExtraField(extra, "author"), {
        values: ["A", "B"],
      });
    });

    it("returns an empty list when the key is absent", function () {
      assert.deepEqual(analyzeExtraField("type: classic", "status"), {
        values: [],
      });
    });
  });

  describe("isValidExtraKey", function () {
    it("accepts the keys a variable line can carry", function () {
      for (const key of [
        "Type",
        "Citation Key",
        "original-container-title",
        "版本说明2",
        "C3N4",
        "creators-ext",
      ]) {
        assert.isTrue(isValidExtraKey(key), key);
      }
    });

    it("refuses what could be written but never read back", function () {
      for (const key of [
        "citation.key",
        "10",
        "",
        "   ",
        "-lead",
        "a:b",
        'quote"key',
        "slash/key",
      ]) {
        assert.isFalse(isValidExtraKey(key), JSON.stringify(key));
      }
    });

    it("agrees with the line classifier", function () {
      for (const key of ["Type", "版本说明2", "citation.key", "10"]) {
        const line = parseExtraLine(`${key}: value`);
        assert.equal(
          line.normalizedKey !== null,
          isValidExtraKey(key),
          `${key} mismatch`,
        );
      }
    });
  });

  describe("needsConflictDecision", function () {
    it("writes without asking when the key is unset or already correct", function () {
      assert.isFalse(needsConflictDecision([], "classic"));
      assert.isFalse(needsConflictDecision(["classic"], "classic"));
    });

    it("asks for a different value", function () {
      assert.isTrue(needsConflictDecision(["manuscript"], "classic"));
    });

    it("asks when the key is repeated, even if the first line matches", function () {
      assert.isTrue(
        needsConflictDecision(["classic", "manuscript"], "classic"),
      );
    });
  });

  describe("mergeExtraField", function () {
    it("keeps the key/value block above prose and sorts it", function () {
      const extra = "Reprinted with permission.\nStatus: in press";

      assert.equal(
        mergeExtraField(extra, "Type", "type", "classic"),
        "Status: in press\nType: classic\nReprinted with permission.",
      );
    });

    it("updates an existing key in place and re-sorts", function () {
      const extra = "Note: keep\nGenre: speech";

      assert.equal(
        mergeExtraField(extra, "Genre", "genre", "regulation"),
        "Genre: regulation\nNote: keep",
      );
    });

    it("collapses repeated lines of the written key", function () {
      const extra = "type: a\ntype: b\nnote: n";

      assert.equal(
        mergeExtraField(extra, "Type", "type", "classic"),
        "note: n\nType: classic",
      );
    });

    it("keeps repeated lines of other keys, in their original order", function () {
      const extra = "author: B\nzz: x\nauthor: A";

      assert.equal(
        mergeExtraField(extra, "Type", "type", "classic"),
        "author: B\nauthor: A\nType: classic\nzz: x",
      );
    });

    it("preserves the original newline style", function () {
      const extra = "Note: n\r\nStatus: x";

      assert.equal(
        mergeExtraField(extra, "Type", "type", "classic"),
        "Note: n\r\nStatus: x\r\nType: classic",
      );
    });

    it("trims blank lines left behind in the prose block", function () {
      const extra = "\n\nReprinted.\n\n";

      assert.equal(
        mergeExtraField(extra, "Type", "type", "classic"),
        "Type: classic\nReprinted.",
      );
    });

    it("writes a single line into an empty field", function () {
      assert.equal(
        mergeExtraField("", "Type", "type", "classic"),
        "Type: classic",
      );
    });

    it("keeps prose that only looks like a key out of the pair block", function () {
      const extra = "- see: appendix\nStatus:";

      assert.equal(
        mergeExtraField(extra, "Type", "type", "classic"),
        "Type: classic\n- see: appendix\nStatus:",
      );
    });

    it("treats a letter-initial prose line as a pair, like Zotero does", function () {
      // Zotero's own reader matches `^([a-z][a-z -_]+):(.+)`, so a line such as
      // "Reprinted from https://example.org" is a variable line for Zotero too.
      // Banyan moves it with the other pairs instead of leaving it in prose.
      assert.equal(
        mergeExtraField(
          "Reprinted from https://example.org",
          "Type",
          "type",
          "classic",
        ),
        "Reprinted from https://example.org\nType: classic",
      );
    });

    it("rewrites a legacy cheater line of the written key", function () {
      const extra = "{:type: manuscript}\nReprinted.";

      assert.equal(
        mergeExtraField(extra, "Type", "type", "classic"),
        "Type: classic\nReprinted.",
      );
    });
  });
});
