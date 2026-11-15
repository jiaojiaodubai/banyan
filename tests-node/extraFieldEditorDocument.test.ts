import { assert } from "chai";
import {
  getExtraKeySuggestions,
  isManagedExtraKey,
  isMarkableExtraKey,
  parseExtraEditorDocument,
  serializeExtraEditorDocument,
} from "../src/utils/extraFieldLines";

describe("extra field editor document", function () {
  function makeDocument() {
    return parseExtraEditorDocument(
      [
        "Status: published",
        "prose note",
        "{:author: Smith}",
        "Type: classic",
        "",
        'creators-ext: {"creatorType":"author"}',
        "DOI: 10/x",
      ].join("\n"),
    );
  }

  it("shows all modern pairs except managed keys, and keeps the rest raw", function () {
    const document = makeDocument();
    assert.deepEqual(
      document.rows.map((row) => [row.key, row.value, row.markable]),
      [
        ["Status", "published", true],
        ["Type", "classic", false],
        ["DOI", "10/x", false],
      ],
    );
    assert.deepEqual(document.managedLines, [
      'creators-ext: {"creatorType":"author"}',
    ]);
    assert.equal(document.other, "prose note\n{:author: Smith}\n");
  });

  it("serializes rows before managed lines and the Other block", function () {
    assert.equal(
      serializeExtraEditorDocument(makeDocument()),
      [
        "Status: published",
        "Type: classic",
        "DOI: 10/x",
        'creators-ext: {"creatorType":"author"}',
        "prose note",
        "{:author: Smith}",
        "",
      ].join("\n"),
    );
  });

  it("rewrites only edited rows, preserving managed lines and Other", function () {
    const document = makeDocument();
    document.rows[0].value = "<i>published</i>";
    document.rows[1].key = "genre";
    assert.equal(
      serializeExtraEditorDocument(document),
      [
        "Status: <i>published</i>",
        "Genre: classic",
        "DOI: 10/x",
        'creators-ext: {"creatorType":"author"}',
        "prose note",
        "{:author: Smith}",
        "",
      ].join("\n"),
    );
  });

  it("supports adding and removing rows without touching managed lines", function () {
    const document = makeDocument();
    document.rows = document.rows.filter((row) => row.key !== "Type");
    document.rows.push({
      key: "Publisher",
      value: "Press",
      markable: true,
    });
    assert.equal(
      serializeExtraEditorDocument(document),
      [
        "Status: published",
        "DOI: 10/x",
        "Publisher: Press",
        'creators-ext: {"creatorType":"author"}',
        "prose note",
        "{:author: Smith}",
        "",
      ].join("\n"),
    );
  });

  it("keeps CRLF when rewriting a value", function () {
    const document = parseExtraEditorDocument("Status: old\r\nprose\r\n");
    document.rows[0].value = "new";
    assert.equal(
      serializeExtraEditorDocument(document),
      "Status: new\r\nprose\r\n",
    );
  });

  it("skips blank draft rows", function () {
    const document = makeDocument();
    document.rows.push({ key: "  ", value: "x", markable: true });
    document.rows.push({ key: "Publisher", value: " ", markable: true });
    assert.notInclude(serializeExtraEditorDocument(document), "Publisher:");
  });

  it("suggests Type, Genre and Status while hiding already used keys", function () {
    assert.deepEqual(getExtraKeySuggestions([], ""), [
      "Type",
      "Genre",
      "Status",
    ]);
    assert.deepEqual(
      getExtraKeySuggestions([{ key: "Type" }, { key: "status" }], ""),
      ["Genre"],
    );
    // The row being edited keeps its own suggestion.
    assert.deepEqual(
      getExtraKeySuggestions([{ key: "Type" }, { key: "Status" }], "", "type"),
      ["Type", "Genre"],
    );
    assert.deepEqual(getExtraKeySuggestions([], "ge"), ["Genre"]);
  });

  it("separates display order from markup eligibility", function () {
    assert.isFalse(isMarkableExtraKey("Type"));
    assert.isFalse(isMarkableExtraKey("language"));
    assert.isTrue(isMarkableExtraKey("Genre"));
    assert.isTrue(isManagedExtraKey("creators-ext"));
  });
});
