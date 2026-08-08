import { assert } from "chai";
import { assignBaseFieldAliases, normalizeExtraKey } from "../src/utils/item";

describe("item utils", function () {
  describe("normalizeExtraKey", function () {
    it("keeps simple lowercase keys unchanged", function () {
      assert.equal(normalizeExtraKey("size"), "size");
      assert.equal(normalizeExtraKey("date2"), "date2");
      assert.equal(normalizeExtraKey("non-ad-year"), "non-ad-year");
      assert.equal(normalizeExtraKey("article-number"), "article-number");
    });

    it("normalizes spaces, underscores and edge separators", function () {
      assert.equal(normalizeExtraKey("My Key"), "my-key");
      assert.equal(normalizeExtraKey("my_key"), "my-key");
      assert.equal(
        normalizeExtraKey("  Leading  Trailing  "),
        "leading-trailing",
      );
      assert.equal(normalizeExtraKey("__pad__"), "pad");
    });

    it("normalizes camelCase / PascalCase", function () {
      assert.equal(normalizeExtraKey("authorID"), "author-id");
      assert.equal(normalizeExtraKey("AuthorID"), "author-id");
      assert.equal(normalizeExtraKey("getHTTPResponse"), "get-http-response");
    });

    it("handles acronyms without mangling the following word", function () {
      assert.equal(normalizeExtraKey("CNKICite"), "cnki-cite");
      assert.equal(normalizeExtraKey("XMLParser"), "xml-parser");
      assert.equal(normalizeExtraKey("HTTPRequest"), "http-request");
    });

    it("handles all-uppercase and space-separated forms", function () {
      assert.equal(normalizeExtraKey("CNKI CITE"), "cnki-cite");
      assert.equal(normalizeExtraKey("CNKI cite"), "cnki-cite");
      assert.equal(normalizeExtraKey("CNKI-Cite"), "cnki-cite");
      assert.equal(normalizeExtraKey("CNKI_CITE"), "cnki-cite");
    });

    it("keeps digits attached to letters", function () {
      assert.equal(normalizeExtraKey("Date2"), "date2");
      assert.equal(normalizeExtraKey("issue2"), "issue2");
      assert.equal(normalizeExtraKey("AuthorID_2"), "author-id-2");
    });

    it("is idempotent", function () {
      const sample = "AuthorID_2";
      assert.equal(
        normalizeExtraKey(normalizeExtraKey(sample)),
        normalizeExtraKey(sample),
      );
    });

    it("coerces non-string values", function () {
      assert.equal(normalizeExtraKey(42), "42");
      assert.equal(normalizeExtraKey(true), "true");
      assert.equal(normalizeExtraKey(null), "");
      assert.equal(normalizeExtraKey(undefined), "");
      assert.equal(normalizeExtraKey({}), "");
    });
  });

  describe("assignBaseFieldAliases", function () {
    it("fills statute title/date aliases from mapped fields", function () {
      const item: Record<string, unknown> = {
        itemType: "statute",
        nameOfAct: "Example Act",
        dateEnacted: "2024-05-01",
      };

      assignBaseFieldAliases("statute", item, {
        getID: (field) => {
          if (field === "nameOfAct") return 1;
          if (field === "dateEnacted") return 2;
          return false;
        },
        getBaseIDFromTypeAndField: (_itemType, field) => {
          if (field === "nameOfAct") return 1;
          if (field === "dateEnacted") return 2;
          return false;
        },
        getName: (field) => {
          if (field === 1) return "title";
          if (field === 2) return "date";
          return false;
        },
      });

      assert.equal(item.title, "Example Act");
      assert.equal(item.date, "2024-05-01");
      assert.equal(item.nameOfAct, "Example Act");
      assert.equal(item.dateEnacted, "2024-05-01");
    });

    it("does not overwrite an existing base-field value", function () {
      const item: Record<string, unknown> = {
        itemType: "statute",
        title: "Normalized Title",
        nameOfAct: "Specific Title",
      };

      assignBaseFieldAliases("statute", item, {
        getID: () => 1,
        getBaseIDFromTypeAndField: () => 1,
        getName: () => "title",
      });

      assert.equal(item.title, "Normalized Title");
    });

    it("fills other canonical base fields such as publisher and number", function () {
      const item: Record<string, unknown> = {
        itemType: "audioRecording",
        label: "Example Label",
        publicLawNumber: "PL-42",
      };

      assignBaseFieldAliases("audioRecording", item, {
        getID: (field) => {
          if (field === "label") return 1;
          if (field === "publicLawNumber") return 2;
          return false;
        },
        getBaseIDFromTypeAndField: (_itemType, field) => {
          if (field === "label") return 1;
          if (field === "publicLawNumber") return 2;
          return false;
        },
        getName: (field) => {
          if (field === 1) return "publisher";
          if (field === 2) return "number";
          return false;
        },
      });

      assert.equal(item.publisher, "Example Label");
      assert.equal(item.number, "PL-42");
      assert.equal(item.label, "Example Label");
      assert.equal(item.publicLawNumber, "PL-42");
    });

    it("skips non-field metadata keys such as key", function () {
      const item: Record<string, unknown> = {
        itemType: "statute",
        key: "ABCD1234",
        nameOfAct: "Example Act",
      };

      assignBaseFieldAliases("statute", item, {
        getID: (field) => {
          if (field === "nameOfAct") return 1;
          return false;
        },
        getBaseIDFromTypeAndField: (_itemType, field) => {
          if (field === "nameOfAct") return 1;
          throw new Error(`Invalid field '${field}'`);
        },
        getName: (field) => {
          if (field === 1) return "title";
          return false;
        },
      });

      assert.equal(item.title, "Example Act");
      assert.equal(item.key, "ABCD1234");
    });
  });
});
