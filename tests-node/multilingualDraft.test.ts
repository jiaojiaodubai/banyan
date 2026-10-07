import { assert } from "chai";
import {
  doiToUrl,
  filterComparableFields,
  findExistingLanguageItem,
  findLanguageMatch,
  hasNonLanguageChanges,
  isSameItemContent,
  normalizeLanguageCode,
  normalizeStyleLanguageTag,
  switchCreatorNameMode,
  type CreatorSnapshot,
  type ItemContentSnapshot,
} from "../src/utils/multilingualDraft";

const content = (
  overrides: Partial<ItemContentSnapshot> = {},
): ItemContentSnapshot => ({
  libraryID: 1,
  itemTypeID: 22,
  fields: { title: "A title", language: "en-US" },
  creators: [
    {
      creatorTypeID: 8,
      fieldMode: 0,
      firstName: "Ada",
      lastName: "Lovelace",
    },
  ],
  ...overrides,
});

describe("multilingual item draft validation", function () {
  it("accepts Zotero's recommended language-country form", function () {
    assert.equal(normalizeLanguageCode("en-US"), "en-US");
    assert.equal(normalizeLanguageCode(" zh-cn "), "zh-CN");
    assert.equal(normalizeLanguageCode("zh"), "zh");
    assert.equal(normalizeLanguageCode(" EN "), "en");
    assert.equal(normalizeLanguageCode("yue"), "yue");
    assert.equal(normalizeLanguageCode("fil"), "fil");
    assert.equal(normalizeLanguageCode("tl"), "fil");
    assert.equal(normalizeLanguageCode("tl-PH"), "fil-PH");
    assert.equal(normalizeLanguageCode("zh-Hans"), "zh-Hans");
    assert.equal(normalizeLanguageCode("zh-Hans-CN"), "zh-Hans-CN");
    assert.equal(normalizeLanguageCode("es-419"), "es-419");
    assert.equal(normalizeLanguageCode("zh_CN"), "zh-CN");
    assert.equal(normalizeLanguageCode("iw"), "he");
    assert.equal(normalizeLanguageCode("sh"), "sr-Latn");
    assert.equal(normalizeLanguageCode("en-UK"), "en-GB");
  });

  it("rejects missing, named, malformed, or non-country region tags", function () {
    assert.isNull(normalizeLanguageCode(""));
    assert.isNull(normalizeLanguageCode("English"));
    assert.isNull(normalizeLanguageCode("Chinese"));
    assert.isNull(normalizeLanguageCode("en-USA"));
    assert.isNull(normalizeLanguageCode("zz"));
    assert.isNull(normalizeLanguageCode("zz-ZZ"));
    assert.isNull(normalizeLanguageCode("en-QQ"));
    assert.isNull(normalizeLanguageCode("en-XX"));
    assert.isNull(normalizeLanguageCode("en-AA"));
    assert.isNull(normalizeLanguageCode("en-EU"));
    assert.isNull(normalizeLanguageCode("en-UN"));
    assert.isNull(normalizeLanguageCode("en-001"));
    assert.isNull(normalizeLanguageCode("zh-Abcd"));
    assert.isNull(normalizeLanguageCode("zh-CN-Hans"));
    assert.isNull(normalizeLanguageCode("zh-Hans-CN-u-ca-gregory"));
  });

  it("finds exact canonical tags across source and related items only", function () {
    const source = { id: 1 };
    const regionalCopy = { id: 2 };
    const genericCopy = { id: 3 };
    const deletedCopy = { id: 4 };
    const items = [
      { item: source, language: "zh-CN" },
      { item: regionalCopy, language: "zh-Hans-CN" },
      { item: genericCopy, language: "zh" },
      { item: deletedCopy, language: "zh_CN", deleted: true },
    ];

    assert.strictEqual(findExistingLanguageItem(items, "zh-cn"), source);
    assert.strictEqual(
      findExistingLanguageItem(items, "zh-Hans-CN"),
      regionalCopy,
    );
    assert.strictEqual(findExistingLanguageItem(items, "zh"), genericCopy);
    assert.isNull(
      findExistingLanguageItem([{ item: source, language: "zh-CN" }], "zh-TW"),
    );
    assert.strictEqual(
      findExistingLanguageItem([{ item: source, language: "zh_CN" }], "zh-CN"),
      source,
    );
    assert.isNull(
      findExistingLanguageItem(
        [{ item: deletedCopy, language: "zh_CN", deleted: true }],
        "zh-CN",
      ),
    );
    assert.strictEqual(
      findExistingLanguageItem([{ item: source, language: "tl" }], "fil"),
      source,
    );
  });

  it("leniently normalizes the tags style lookups receive", function () {
    assert.equal(normalizeStyleLanguageTag("  ZH_cn "), "zh-cn");
    assert.equal(normalizeStyleLanguageTag("en-UK"), "en-gb");
    // Tags the strict dialog validation refuses still normalize, so a style
    // that asks for them matches instead of failing the lookup.
    assert.equal(normalizeStyleLanguageTag("ca-ES-valencia"), "ca-es-valencia");
    assert.equal(normalizeStyleLanguageTag("ar-001"), "ar-001");
    assert.equal(normalizeStyleLanguageTag("zh-cmn-Hans"), "zh-cmn-hans");
    assert.equal(normalizeStyleLanguageTag(""), "");
    assert.equal(normalizeStyleLanguageTag(undefined), "");
  });

  it("resolves language matches in the source, then tag, then ID order", function () {
    const source = { id: 1 };
    const chineseTraditional = { id: 2 };
    const chineseSimplified = { id: 3 };
    const genericChinese = { id: 4 };
    const candidates = [
      { item: chineseTraditional, language: "zh-tw" },
      { item: source, language: "zh-cn", isSource: true },
      { item: chineseSimplified, language: "zh-hans-cn" },
      { item: genericChinese, language: "zh" },
    ];

    assert.strictEqual(findLanguageMatch(candidates, "zh-CN"), source);
    assert.strictEqual(
      findLanguageMatch(candidates, "zh-Hans-CN"),
      chineseSimplified,
    );
    assert.strictEqual(
      findLanguageMatch(candidates, "zh-TW"),
      chineseTraditional,
    );
    // An exact tag always beats the prefix fallback, even for a bare code...
    assert.strictEqual(findLanguageMatch(candidates, "zh"), genericChinese);
    assert.isNull(findLanguageMatch(candidates, "en"));

    // ...while a preference with no exact match falls back to the prefix tier,
    // where the source outranks the copies even though its tag sorts later.
    const regionalOnly = [
      { item: chineseTraditional, language: "zh-tw" },
      { item: source, language: "zh-cn", isSource: true },
      { item: chineseSimplified, language: "zh-hans-cn" },
    ];
    assert.strictEqual(findLanguageMatch(regionalOnly, "zh"), source);

    // Without a source flag: lowest tag, then lowest ID, regardless of order.
    const copies = [
      { item: { id: 11 }, language: "zh-tw" },
      { item: { id: 12 }, language: "zh-hans-cn" },
      { item: { id: 13 }, language: "zh-cn" },
    ];
    assert.equal(findLanguageMatch(copies, "zh")?.id, 13);
    assert.equal(findLanguageMatch([...copies].reverse(), "zh")?.id, 13);
    assert.equal(
      findLanguageMatch(
        [
          { item: { id: 21 }, language: "zh-cn" },
          { item: { id: 20 }, language: "zh-cn" },
        ],
        "zh-CN",
      )?.id,
      20,
    );
  });

  it("matches tags the strict validation refuses", function () {
    const catalanValencia = { id: 1 };
    const latinAmericanSpanish = { id: 2 };

    assert.strictEqual(
      findLanguageMatch(
        [{ item: catalanValencia, language: "ca-es-valencia" }],
        "ca-ES-valencia",
      ),
      catalanValencia,
    );
    assert.strictEqual(
      findLanguageMatch(
        [{ item: catalanValencia, language: "ca-es-valencia" }],
        "ca",
      ),
      catalanValencia,
    );
    assert.strictEqual(
      findLanguageMatch(
        [{ item: latinAmericanSpanish, language: "es-419" }],
        "es",
      ),
      latinAmericanSpanish,
    );
  });

  it("requires a field or creator change beyond language", function () {
    const sourceFields = filterComparableFields({
      title: "Source",
      language: "en-US",
      abstractNote: "Original summary",
    });
    const sourceCreators: CreatorSnapshot[] = [
      {
        creatorTypeID: 1,
        fieldMode: 0,
        firstName: "Ada",
        lastName: "Lovelace",
      },
    ];

    assert.isFalse(
      hasNonLanguageChanges(
        sourceFields,
        filterComparableFields({
          title: "Source",
          language: "zh-CN",
          abstractNote: "",
        }),
        sourceCreators,
        sourceCreators,
      ),
    );
    assert.isTrue(
      hasNonLanguageChanges(
        sourceFields,
        filterComparableFields({
          title: "译本",
          language: "zh-CN",
          abstractNote: "Original summary",
        }),
        sourceCreators,
        sourceCreators,
      ),
    );
    assert.isFalse(
      hasNonLanguageChanges(
        sourceFields,
        filterComparableFields({
          title: "Source",
          language: "zh-CN",
          abstractNote: "Updated summary",
        }),
        sourceCreators,
        sourceCreators,
      ),
    );
    assert.isTrue(
      hasNonLanguageChanges(
        sourceFields,
        filterComparableFields({
          title: "Source",
          language: "zh-CN",
          abstractNote: "Original summary",
        }),
        sourceCreators,
        [{ ...sourceCreators[0], firstName: "爱达" }],
      ),
    );
  });

  it("builds a DOI resolver URL and rejects invalid values", function () {
    assert.equal(
      doiToUrl("10.1080/14616688.2020.1722215"),
      "https://doi.org/10.1080/14616688.2020.1722215",
    );
    assert.equal(
      doiToUrl(" https://doi.org/10.1000/xyz123 "),
      "https://doi.org/10.1000/xyz123",
    );
    assert.equal(
      doiToUrl("doi: 10.1000/xyz123"),
      "https://doi.org/10.1000/xyz123",
    );
    assert.isNull(doiToUrl(""));
    assert.isNull(doiToUrl("not-a-doi"));
    assert.isNull(doiToUrl(undefined));
    assert.isNull(doiToUrl("https://example.com/10.1000/xyz123"));
  });

  it("converts a creator name between one and two fields", function () {
    // Two fields -> one: first name goes in front, as it is read.
    assert.deepEqual(
      switchCreatorNameMode(
        { fieldMode: 0, firstName: "Dejan", lastName: "Iliev" },
        1,
      ),
      { fieldMode: 1, firstName: "", lastName: "Dejan Iliev" },
    );
    // One field -> two: all but the last word becomes the first name.
    assert.deepEqual(
      switchCreatorNameMode(
        { fieldMode: 1, firstName: "", lastName: "Dejan Iliev" },
        0,
      ),
      { fieldMode: 0, firstName: "Dejan", lastName: "Iliev" },
    );
    assert.deepEqual(
      switchCreatorNameMode(
        { fieldMode: 1, firstName: "", lastName: "Ludwig van Beethoven" },
        0,
      ),
      { fieldMode: 0, firstName: "Ludwig van", lastName: "Beethoven" },
    );
  });

  it("keeps a name without spaces whole when splitting to two fields", function () {
    // Chinese names have no word break to split on.
    assert.deepEqual(
      switchCreatorNameMode(
        { fieldMode: 1, firstName: "", lastName: "洪卓民" },
        0,
      ),
      { fieldMode: 0, firstName: "", lastName: "洪卓民" },
    );
    // Only a last name: nothing to put in front when merging.
    assert.deepEqual(
      switchCreatorNameMode(
        { fieldMode: 0, firstName: "", lastName: "洪卓民" },
        1,
      ),
      { fieldMode: 1, firstName: "", lastName: "洪卓民" },
    );
  });

  it("returns a copy when the name is already in the requested mode", function () {
    const name = { fieldMode: 0 as const, firstName: "A", lastName: "B" };
    const same = switchCreatorNameMode(name, 0);
    assert.deepEqual(same, name);
    assert.notStrictEqual(same, name);
  });

  it("escapes DOI characters that would truncate the resolver URL", function () {
    assert.equal(
      doiToUrl("10.1000/xyz#fragment"),
      "https://doi.org/10.1000/xyz%23fragment",
    );
    assert.equal(
      doiToUrl("10.1000/xyz?query"),
      "https://doi.org/10.1000/xyz%3fquery",
    );
    // `%` is escaped first, so an escape added here is not encoded twice.
    assert.equal(doiToUrl("10.1000/100%"), "https://doi.org/10.1000/100%25");
    assert.equal(
      doiToUrl('10.1000/xyz"quoted'),
      "https://doi.org/10.1000/xyz%22quoted",
    );
    // `/` is valid in a DOI and stays literal.
    assert.equal(doiToUrl("10.1000/a/b"), "https://doi.org/10.1000/a/b");
  });

  describe("item content snapshots", function () {
    it("holds for the same content copied apart", function () {
      assert.isTrue(isSameItemContent(content(), content()));
    });

    it("detects a changed field, creator, type, or library", function () {
      assert.isFalse(
        isSameItemContent(content(), content({ fields: { title: "B title" } })),
      );
      assert.isFalse(
        isSameItemContent(
          content(),
          content({
            creators: [
              {
                creatorTypeID: 8,
                fieldMode: 1,
                firstName: "",
                lastName: "Lovelace",
              },
            ],
          }),
        ),
      );
      assert.isFalse(isSameItemContent(content(), content({ itemTypeID: 7 })));
      assert.isFalse(isSameItemContent(content(), content({ libraryID: 9 })));
    });

    it("detects a field that appeared after the snapshot was taken", function () {
      const before = content();
      const after = content({
        fields: { title: "A title", language: "en-US", extra: "new" },
      });
      assert.isFalse(isSameItemContent(before, after));
    });
  });
});
