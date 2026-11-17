import { assert } from "chai";
import {
  parseStyleUpdatedTime,
  pickStyleDuplicateKeeper,
  pickStyleFilename,
  resolveStyleWriteTarget,
  type StyleFileRecord,
  type StyleWriteTargetIO,
} from "../src/utils/styleFiles";

const DIR = "/styles";

/**
 * In-memory stand-in for the data directory: file name -> `INFO.id`, where a
 * null id marks a file that cannot be parsed as a style.
 */
function createFakeIO(
  files: Record<string, string | null>,
): StyleWriteTargetIO {
  const toKey = (path: string) => path.slice(DIR.length + 1);
  return {
    dir: async () => DIR,
    join: (dir, filename) => `${dir}/${filename}`,
    basename: (path) => path.split("/").pop() ?? "",
    children: async () => Object.keys(files).map((name) => `${DIR}/${name}`),
    exists: async (path) =>
      Object.prototype.hasOwnProperty.call(files, toKey(path)),
    readStyleId: async (path) => files[toKey(path)] ?? null,
  };
}

function createRecord(
  filename: string,
  overrides: Partial<StyleFileRecord> = {},
): StyleFileRecord {
  return {
    id: "my-style",
    filename,
    path: `${DIR}/${filename}`,
    updated: 0,
    ...overrides,
  };
}

describe("style files", function () {
  describe("naming", function () {
    it("uses the canonical name for a style that is not on disk", function () {
      assert.equal(pickStyleFilename("my-style", []), "my-style.js");
    });

    it("keeps ids that sanitize to the same name apart", function () {
      assert.equal(pickStyleFilename("a/b", ["a_b.js"]), "a_b--b.js");
    });

    it("keeps counting the alias suffixes when both names are taken", function () {
      assert.equal(
        pickStyleFilename("my-style", ["my-style.js", "my-style--my-style.js"]),
        "my-style--my-style-2.js",
      );
    });
  });

  describe("write target", function () {
    it("resolves an indexed style to the file the index points at", async function () {
      const target = await resolveStyleWriteTarget(
        "my-style",
        { filename: "my-style.js", title: "My Style" },
        createFakeIO({ "my-style.js": "my-style" }),
      );

      assert.deepEqual(target, {
        kind: "indexed",
        path: `${DIR}/my-style.js`,
        title: "My Style",
      });
    });

    it("overwrites the file that declares the id instead of adding an alias", async function () {
      // Regression: an import used to pick a unique file name whenever the id was
      // not in the in-memory index, which created `my-style--my-style.js` next to
      // the file that already declared `my-style`.
      const target = await resolveStyleWriteTarget(
        "my-style",
        undefined,
        createFakeIO({
          "my-style.js": "other-style",
          "my-style--my-style.js": "my-style",
        }),
      );

      assert.deepEqual(target, {
        kind: "file",
        path: `${DIR}/my-style--my-style.js`,
      });
    });

    it("picks the canonical name when nothing on disk declares the id", async function () {
      const target = await resolveStyleWriteTarget(
        "my-style",
        undefined,
        createFakeIO({ "other-style.js": "other-style" }),
      );

      assert.deepEqual(target, { kind: "new", path: `${DIR}/my-style.js` });
    });

    it("falls back to an alias when the canonical name belongs to another style", async function () {
      const target = await resolveStyleWriteTarget(
        "my-style",
        undefined,
        createFakeIO({ "my-style.js": "other-style" }),
      );

      assert.deepEqual(target, {
        kind: "new",
        path: `${DIR}/my-style--my-style.js`,
      });
    });

    it("ignores files that cannot be parsed as a style", async function () {
      const target = await resolveStyleWriteTarget(
        "my-style",
        undefined,
        createFakeIO({ "broken.js": null }),
      );

      assert.deepEqual(target, { kind: "new", path: `${DIR}/my-style.js` });
    });
  });

  describe("duplicate resolution", function () {
    it("keeps the file with the newer INFO.updated", function () {
      const older = createRecord("my-style.js", { updated: 1 });
      const newer = createRecord("my-style--my-style.js", { updated: 2 });

      assert.strictEqual(pickStyleDuplicateKeeper(older, newer), newer);
      assert.strictEqual(pickStyleDuplicateKeeper(newer, older), newer);
    });

    it("prefers the canonical file name when the timestamps match", function () {
      const canonical = createRecord("my-style.js", { updated: 5 });
      const alias = createRecord("my-style--my-style.js", { updated: 5 });

      assert.strictEqual(pickStyleDuplicateKeeper(alias, canonical), canonical);
      assert.strictEqual(pickStyleDuplicateKeeper(canonical, alias), canonical);
    });

    it("keeps the first scanned file when neither name is canonical", function () {
      const first = createRecord("a--x.js", { updated: 5 });
      const second = createRecord("a--y.js", { updated: 5 });

      assert.strictEqual(pickStyleDuplicateKeeper(first, second), first);
      assert.strictEqual(pickStyleDuplicateKeeper(second, first), second);
    });
  });

  describe("INFO.updated parsing", function () {
    it("parses an ISO timestamp", function () {
      assert.equal(
        parseStyleUpdatedTime("2026-06-25T10:23:23+08:00"),
        Date.parse("2026-06-25T10:23:23+08:00"),
      );
    });

    it("treats missing and invalid values as the oldest possible date", function () {
      assert.equal(parseStyleUpdatedTime(undefined), 0);
      assert.equal(parseStyleUpdatedTime(""), 0);
      assert.equal(parseStyleUpdatedTime("not a date"), 0);
    });
  });
});
